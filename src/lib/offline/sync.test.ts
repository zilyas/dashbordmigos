import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  getClockGuard,
  getLease,
  getPendingSale,
  getPendingSales,
  queueSale,
  resetOfflineDbForTests,
  saveSnapshot,
  type OfflineSnapshot,
  type PendingSale,
} from "@/lib/offline/db";
import {
  recordOfflineSale,
  refreshSnapshot,
  syncNow,
  uploadPendingSale,
} from "@/lib/offline/sync";

const CONFIG = {
  userId: "user-1",
  role: "SELLER",
  storeId: "store-1",
  storeName: "Shop",
  currency: "NGN",
  taxRate: 0,
  unitsEnabled: false,
};

const snapshot: OfflineSnapshot = {
  publicKey: "PUBKEY",
  lease: "v1.lease.sig",
  fetchedAt: "2026-02-01T10:00:00.000Z",
  config: CONFIG,
  products: [],
  recentSales: [],
};

function snapshotBody(recentSales: unknown[] = [], fetchedAt = "2026-02-01T12:00:00.000Z") {
  return {
    publicKey: "PUBKEY",
    lease: "v1.lease.sig",
    leaseDenied: null,
    fetchedAt,
    config: CONFIG,
    products: [],
    recentSales,
  };
}

function serverSale(id: string) {
  return {
    id,
    invoiceNumber: `INV-${id}`,
    total: 25,
    createdAt: "2026-02-01T11:00:00.000Z",
    customerName: null,
    paymentMethod: "CASH",
    itemCount: 1,
  };
}

function queued(id: string, minute = 0): Omit<PendingSale, "status" | "attempts"> {
  return {
    clientSaleId: id,
    createdAt: `2026-02-01T11:${String(minute).padStart(2, "0")}:00.000Z`,
    expectedTotal: 25,
    lease: "v1.lease.sig",
    sale: { discountPercent: 0, paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** A fetch stub that records every call, so "one at a time" is observable. */
function stubFetch(handler: Handler) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

const healthOk: Handler = () => json({ status: "ok" });

beforeEach(() => {
  resetOfflineDbForTests();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  // Web Locks is absent in Node, so the in-memory fallback is what runs here
  // unless a test installs a stub. Both paths are exercised below.
  delete (globalThis as { navigator?: unknown }).navigator;
});

describe("refreshSnapshot", () => {
  it("stores the snapshot and resets the clock guard to server time", async () => {
    const { fetch } = stubFetch(() => json(snapshotBody([], "2026-02-01T12:00:00.000Z")));
    const result = await refreshSnapshot({ fetch });
    expect(result.ok).toBe(true);
    expect(await getLease()).toBe("v1.lease.sig");
    expect(await getClockGuard()).toBe(Date.parse("2026-02-01T12:00:00.000Z"));
  });

  it("classifies 401 as unauthorized and 500 as server", async () => {
    const unauth = stubFetch(() => json({ error: { code: "unauthorized", message: "nope" } }, 401));
    expect(await refreshSnapshot({ fetch: unauth.fetch })).toMatchObject({
      ok: false,
      reason: "unauthorized",
    });
    const boom = stubFetch(() => json({ error: { code: "internal_error", message: "x" } }, 500));
    expect(await refreshSnapshot({ fetch: boom.fetch })).toMatchObject({
      ok: false,
      reason: "server",
    });
  });
});

describe("recordOfflineSale", () => {
  it("queues a sale and raises the clock guard", async () => {
    await saveSnapshot(snapshot);
    const result = await recordOfflineSale(
      "c1",
      { discountPercent: 0, paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] },
      25,
      { now: () => 1_000 }
    );
    expect(result.saved).toBe(true);
    expect(await getClockGuard()).toBe(1_000);
  });

  it("refuses to sell when the device clock has jumped backwards", async () => {
    await saveSnapshot(snapshot);
    await recordOfflineSale(
      "c1",
      { discountPercent: 0, paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] },
      25,
      { now: () => 5_000 }
    );
    const result = await recordOfflineSale(
      "c2",
      { discountPercent: 0, paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] },
      25,
      { now: () => 4_000 }
    );
    expect(result.saved).toBe(false);
    if (!result.saved) expect(result.reason).toBe("clock_moved_back");
    expect(await getPendingSales()).toHaveLength(1);
  });

  it("refuses to sell with no lease cached", async () => {
    const result = await recordOfflineSale(
      "c1",
      { discountPercent: 0, paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] },
      25,
      { now: () => 1_000 }
    );
    expect(result).toMatchObject({ saved: false, reason: "no_lease" });
  });
});

describe("uploadPendingSale", () => {
  const sale: PendingSale = { ...queued("c1"), status: "pending", attempts: 0 };

  it("sends the original clientSaleId", async () => {
    const { fetch, calls } = stubFetch(() =>
      json({ ok: true, saleId: "s1", invoiceNumber: "INV-1", replayed: false, total: 25 })
    );
    await uploadPendingSale(sale, { fetch });
    expect(calls[0]?.body).toMatchObject({ clientSaleId: "c1", lease: "v1.lease.sig" });
  });

  it("treats a replay as success", async () => {
    const { fetch } = stubFetch(() =>
      json({ ok: true, saleId: "s1", invoiceNumber: "INV-1", replayed: true, total: 25 })
    );
    expect(await uploadPendingSale(sale, { fetch })).toMatchObject({
      kind: "accepted",
      replayed: true,
      saleId: "s1",
    });
  });

  it("keeps price_changed's serverTotal", async () => {
    const { fetch } = stubFetch(() =>
      json({ error: { code: "price_changed", message: "moved", serverTotal: 31 } }, 422)
    );
    expect(await uploadPendingSale(sale, { fetch })).toMatchObject({
      kind: "terminal",
      code: "price_changed",
      serverTotal: 31,
    });
  });

  it("retries on 503 and on 500, and stops on 401", async () => {
    const contention = stubFetch(() =>
      json({ error: { code: "invoice_contention", message: "busy" } }, 503)
    );
    expect(await uploadPendingSale(sale, { fetch: contention.fetch })).toMatchObject({
      kind: "retry",
    });
    const boom = stubFetch(() => json({ error: { code: "internal_error", message: "x" } }, 500));
    expect(await uploadPendingSale(sale, { fetch: boom.fetch })).toMatchObject({ kind: "retry" });
    const out = stubFetch(() => json({ error: { code: "unauthorized", message: "sign in" } }, 401));
    expect(await uploadPendingSale(sale, { fetch: out.fetch })).toMatchObject({
      kind: "signed_out",
    });
  });

  it("retries on a network error, since the server may have recorded it", async () => {
    const { fetch } = stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await uploadPendingSale(sale, { fetch })).toMatchObject({ kind: "retry" });
  });

  it("does not accept a 2xx without an explicit ok:true", async () => {
    const { fetch } = stubFetch(() => new Response("<html>portal</html>", { status: 200 }));
    expect(await uploadPendingSale(sale, { fetch })).toMatchObject({ kind: "retry" });
  });
});

describe("syncNow", () => {
  it("stops before touching the queue when the server is unreachable", async () => {
    await queueSale(queued("c1"));
    const { fetch, calls } = stubFetch(() => json({ status: "error" }, 503));
    const summary = await syncNow({ fetch });
    expect(summary).toMatchObject({ ran: true, stopped: "offline", uploaded: 0 });
    expect(calls).toHaveLength(1);
    expect((await getPendingSale("c1"))?.status).toBe("pending");
  });

  it("leaves a sale pending on 5xx", async () => {
    await queueSale(queued("c1"));
    const { fetch } = stubFetch((url) =>
      url.includes("/health")
        ? healthOk(url)
        : json({ error: { code: "invoice_contention", message: "busy" } }, 503)
    );
    const summary = await syncNow({ fetch });
    expect(summary).toMatchObject({ retry: 1, uploaded: 0, pruned: 0 });
    const record = await getPendingSale("c1");
    expect(record).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("moves a 4xx sale to review and keeps the server's message", async () => {
    await queueSale(queued("c1"));
    const { fetch } = stubFetch((url) =>
      url.includes("/health")
        ? healthOk(url)
        : json(
            { error: { code: "insufficient_stock", message: "Only 1 left.", serverTotal: 9 } },
            409
          )
    );
    const summary = await syncNow({ fetch });
    expect(summary).toMatchObject({ review: 1, uploaded: 0 });
    expect(await getPendingSale("c1")).toMatchObject({
      status: "review",
      lastError: { code: "insufficient_stock", message: "Only 1 left." },
      serverTotal: 9,
    });
  });

  it("uploads oldest first, one at a time, and prunes only what the snapshot lists", async () => {
    await queueSale(queued("c-late", 30));
    await queueSale(queued("c-early", 10));

    let inflight = 0;
    let maxInflight = 0;
    const order: string[] = [];
    const { fetch } = stubFetch(async (url, init) => {
      if (url.includes("/health")) return healthOk(url);
      if (url.endsWith("/sales")) {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        const body = JSON.parse(String(init?.body)) as { clientSaleId: string };
        order.push(body.clientSaleId);
        await new Promise((r) => setTimeout(r, 1));
        inflight -= 1;
        return json({
          ok: true,
          saleId: `s-${body.clientSaleId}`,
          invoiceNumber: `INV-${body.clientSaleId}`,
          replayed: false,
          total: 25,
        });
      }
      // Snapshot lists only the earlier sale, so only that one may be pruned.
      return json(snapshotBody([serverSale("s-c-early")]));
    });

    const summary = await syncNow({ fetch });
    expect(order).toEqual(["c-early", "c-late"]);
    expect(maxInflight).toBe(1);
    expect(summary).toMatchObject({ uploaded: 2, pruned: 1 });
    expect(await getPendingSale("c-early")).toBeUndefined();
    // Confirmed but unproven: kept, so a failed refresh cannot lose it.
    expect(await getPendingSale("c-late")).toMatchObject({
      status: "synced",
      serverSaleId: "s-c-late",
    });
  });

  it("keeps a confirmed sale when the refresh itself fails", async () => {
    await queueSale(queued("c1"));
    const { fetch } = stubFetch((url) => {
      if (url.includes("/health")) return healthOk(url);
      if (url.endsWith("/sales")) {
        return json({
          ok: true,
          saleId: "s1",
          invoiceNumber: "INV-1",
          replayed: false,
          total: 25,
        });
      }
      return json({ error: { code: "internal_error", message: "x" } }, 500);
    });
    const summary = await syncNow({ fetch });
    expect(summary).toMatchObject({ uploaded: 1, pruned: 0, stopped: "snapshot_failed" });
    expect(await getPendingSale("c1")).toMatchObject({ status: "synced" });
  });

  it("stops the whole queue on 401", async () => {
    await queueSale(queued("c1", 10));
    await queueSale(queued("c2", 20));
    let posts = 0;
    const { fetch } = stubFetch((url) => {
      if (url.includes("/health")) return healthOk(url);
      posts += 1;
      return json({ error: { code: "unauthorized", message: "Sign in to sync." } }, 401);
    });
    const summary = await syncNow({ fetch });
    expect(posts).toBe(1);
    expect(summary).toMatchObject({ stopped: "signed_out" });
    expect((await getPendingSales()).every((s) => s.status === "pending")).toBe(true);
  });

  it("two concurrent drains do not double-upload (in-memory fallback)", async () => {
    await queueSale(queued("c1"));
    let posts = 0;
    const { fetch } = stubFetch(async (url) => {
      if (url.includes("/health")) {
        await new Promise((r) => setTimeout(r, 2));
        return healthOk(url);
      }
      if (url.endsWith("/sales")) {
        posts += 1;
        return json({
          ok: true,
          saleId: "s1",
          invoiceNumber: "INV-1",
          replayed: false,
          total: 25,
        });
      }
      return json(snapshotBody([serverSale("s1")]));
    });

    const [a, b] = await Promise.all([syncNow({ fetch }), syncNow({ fetch })]);
    expect(posts).toBe(1);
    expect([a.ran, b.ran].filter(Boolean)).toHaveLength(1);
  });

  it("two concurrent drains do not double-upload (Web Locks)", async () => {
    await queueSale(queued("c1"));
    // Minimal Web Locks stand-in with the one behaviour we rely on: a second
    // ifAvailable request while the lock is held gets a null lock.
    let held = false;
    (globalThis as { navigator?: unknown }).navigator = {
      locks: {
        async request(
          _name: string,
          _options: { ifAvailable?: boolean },
          callback: (lock: unknown) => Promise<unknown>
        ) {
          if (held) return callback(null);
          held = true;
          try {
            return await callback({ name: _name });
          } finally {
            held = false;
          }
        },
      },
    };

    let posts = 0;
    const { fetch } = stubFetch(async (url) => {
      if (url.includes("/health")) {
        await new Promise((r) => setTimeout(r, 2));
        return healthOk(url);
      }
      if (url.endsWith("/sales")) {
        posts += 1;
        return json({
          ok: true,
          saleId: "s1",
          invoiceNumber: "INV-1",
          replayed: false,
          total: 25,
        });
      }
      return json(snapshotBody([serverSale("s1")]));
    });

    const [a, b] = await Promise.all([syncNow({ fetch }), syncNow({ fetch })]);
    expect(posts).toBe(1);
    expect([a.ran, b.ran].filter(Boolean)).toHaveLength(1);
  });

  it("treats a replayed sale exactly like a fresh success", async () => {
    await queueSale(queued("c1"));
    const { fetch } = stubFetch((url) => {
      if (url.includes("/health")) return healthOk(url);
      if (url.endsWith("/sales")) {
        return json({ ok: true, saleId: "s1", invoiceNumber: "INV-1", replayed: true, total: 25 });
      }
      return json(snapshotBody([serverSale("s1")]));
    });
    const summary = await syncNow({ fetch });
    expect(summary).toMatchObject({ uploaded: 1, replayed: 1, pruned: 1 });
    expect(await getPendingSale("c1")).toBeUndefined();
  });

  it("walks past sales parked in review", async () => {
    await queueSale(queued("c1"));
    const terminal = stubFetch((url) =>
      url.includes("/health")
        ? healthOk(url)
        : json({ error: { code: "idempotency_conflict", message: "conflict" } }, 409)
    );
    await syncNow({ fetch: terminal.fetch });

    const second = stubFetch(healthOk);
    const summary = await syncNow({ fetch: second.fetch });
    // Health check only: nothing was re-posted.
    expect(second.calls).toHaveLength(1);
    expect(summary).toMatchObject({ uploaded: 0, review: 0, retry: 0 });
  });
});
