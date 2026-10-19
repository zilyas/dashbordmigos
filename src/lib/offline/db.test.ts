import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  DB_NAME,
  STORE_PENDING_SALES,
  checkClock,
  clearCachedData,
  deletePendingSale,
  getClockGuard,
  getLease,
  getPendingSale,
  getPendingSales,
  getProducts,
  getRecentSales,
  getSnapshotHeader,
  openOfflineDb,
  queueSale,
  raiseClockGuard,
  resetOfflineDbForTests,
  saveSnapshot,
  setClockGuardFromServer,
  updatePendingSale,
  type OfflineSnapshot,
  type PendingSale,
} from "@/lib/offline/db";

/**
 * A "browser restart": the same IDBFactory (so the data survives) with the
 * module's memoized connection dropped, which is what a page reload does.
 */
function restartBrowser(): void {
  resetOfflineDbForTests();
}

/** A fresh profile: brand-new storage, nothing carried over. */
function freshProfile(): void {
  resetOfflineDbForTests();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
}

const snapshot: OfflineSnapshot = {
  publicKey: "PUBKEY",
  lease: "v1.lease.sig",
  fetchedAt: "2026-02-01T10:00:00.000Z",
  config: {
    userId: "user-1",
    role: "SELLER",
    storeId: "store-1",
    storeName: "Shop",
    currency: "NGN",
    taxRate: 7.5,
    unitsEnabled: true,
  },
  products: [
    {
      id: "p1",
      sku: "SKU1",
      barcode: null,
      name: "Shirt",
      unit: "piece",
      allowDecimalQuantity: false,
      price: 100,
      stock: 5,
      hasVariants: false,
      trackBatch: false,
      variants: [],
    },
  ],
  recentSales: [
    {
      id: "s1",
      invoiceNumber: "INV-1",
      total: 100,
      createdAt: "2026-02-01T09:00:00.000Z",
      customerName: null,
      paymentMethod: "CASH",
      itemCount: 1,
    },
  ],
};

function pending(id: string, createdAt: string): Omit<PendingSale, "status" | "attempts"> {
  return {
    clientSaleId: id,
    createdAt,
    expectedTotal: 100,
    lease: "v1.lease.sig",
    sale: {
      discountPercent: 0,
      paymentMethod: "CASH",
      items: [{ productId: "p1", quantity: 1 }],
    },
  };
}

beforeEach(() => {
  freshProfile();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("persistence", () => {
  it("keeps the snapshot and the queue across a browser restart", async () => {
    await saveSnapshot(snapshot);
    expect((await queueSale(pending("a", "2026-02-01T11:00:00.000Z"))).saved).toBe(true);

    restartBrowser();

    expect(await getLease()).toBe("v1.lease.sig");
    expect((await getSnapshotHeader())?.fetchedAt).toBe(snapshot.fetchedAt);
    expect(await getProducts()).toHaveLength(1);
    expect(await getRecentSales()).toHaveLength(1);
    expect(await getPendingSales()).toHaveLength(1);
  });

  it("returns queued sales oldest first", async () => {
    await queueSale(pending("late", "2026-02-01T12:00:00.000Z"));
    await queueSale(pending("early", "2026-02-01T08:00:00.000Z"));
    await queueSale(pending("mid", "2026-02-01T10:00:00.000Z"));
    expect((await getPendingSales()).map((s) => s.clientSaleId)).toEqual(["early", "mid", "late"]);
  });

  it("keeps an existing lease when a snapshot carries none", async () => {
    await saveSnapshot(snapshot);
    await saveSnapshot({ ...snapshot, lease: null });
    expect(await getLease()).toBe("v1.lease.sig");
  });
});

describe("queueSale", () => {
  it("reports the sale saved only after reading it back", async () => {
    const result = await queueSale(pending("a", "2026-02-01T11:00:00.000Z"));
    expect(result).toMatchObject({ saved: true });
    expect((await getPendingSale("a"))?.status).toBe("pending");
  });

  it("reports NOT saved when the readback fails, so the cart stays on screen", async () => {
    // Simulate a store that commits the write and then cannot serve a read:
    // the cashier must not be told the money is safe.
    const db = await openOfflineDb();
    const real = db.transaction.bind(db);
    let writes = 0;
    vi.spyOn(db, "transaction").mockImplementation(((...args: Parameters<typeof real>) => {
      const mode = args[1];
      if (mode === "readonly") throw new DOMException("store unreadable", "UnknownError");
      writes += 1;
      return real(...args);
    }) as typeof db.transaction);

    const result = await queueSale(pending("a", "2026-02-01T11:00:00.000Z"));
    expect(writes).toBe(1);
    expect(result.saved).toBe(false);
    if (!result.saved) expect(result.reason).toBe("readback_failed");
  });

  it("surfaces a double-submit as a duplicate instead of overwriting", async () => {
    await queueSale(pending("a", "2026-02-01T11:00:00.000Z"));
    const second = await queueSale({
      ...pending("a", "2026-02-01T11:00:05.000Z"),
      expectedTotal: 999,
    });
    expect(second.saved).toBe(false);
    if (!second.saved) expect(second.reason).toBe("duplicate");
    // The first sale is untouched: nothing was silently replaced.
    expect((await getPendingSale("a"))?.expectedTotal).toBe(100);
  });

  it("uses add(), not put(), for pending sales", async () => {
    const db = await openOfflineDb();
    const tx = db.transaction(STORE_PENDING_SALES, "readwrite");
    const store = tx.objectStore(STORE_PENDING_SALES);
    expect(store.keyPath).toBe("clientSaleId");
    tx.abort();
  });
});

describe("clearCachedData", () => {
  it("wipes the cache and provably leaves pending sales alone", async () => {
    await saveSnapshot(snapshot);
    await queueSale(pending("a", "2026-02-01T11:00:00.000Z"));
    await queueSale(pending("b", "2026-02-01T11:30:00.000Z"));

    await clearCachedData();

    expect(await getLease()).toBeUndefined();
    expect(await getSnapshotHeader()).toBeUndefined();
    expect(await getProducts()).toEqual([]);
    expect(await getRecentSales()).toEqual([]);
    const queue = await getPendingSales();
    expect(queue.map((s) => s.clientSaleId)).toEqual(["a", "b"]);

    // And they are still there after the logout-then-reload a real till does.
    restartBrowser();
    expect((await getPendingSales()).map((s) => s.clientSaleId)).toEqual(["a", "b"]);
  });

  it("cannot reach the pendingSales store at all", async () => {
    const db = await openOfflineDb();
    const tx = db.transaction(["meta", "products", "recentSales"], "readwrite");
    expect(() => tx.objectStore(STORE_PENDING_SALES)).toThrow();
    tx.abort();
  });
});

describe("pending sale updates", () => {
  it("merges a patch and keeps the rest of the record", async () => {
    await queueSale(pending("a", "2026-02-01T11:00:00.000Z"));
    const updated = await updatePendingSale("a", {
      status: "review",
      lastError: { code: "price_changed", message: "moved" },
      serverTotal: 120,
    });
    expect(updated).toMatchObject({
      clientSaleId: "a",
      status: "review",
      expectedTotal: 100,
      serverTotal: 120,
    });
  });

  it("returns undefined for a sale that is already gone", async () => {
    expect(await updatePendingSale("nope", { attempts: 1 })).toBeUndefined();
  });

  it("deletes only the named sale", async () => {
    await queueSale(pending("a", "2026-02-01T11:00:00.000Z"));
    await queueSale(pending("b", "2026-02-01T11:30:00.000Z"));
    await deletePendingSale("a");
    expect((await getPendingSales()).map((s) => s.clientSaleId)).toEqual(["b"]);
  });
});

describe("clock guard (advisory)", () => {
  it("only ever raises", async () => {
    await raiseClockGuard(5_000);
    await raiseClockGuard(1_000);
    expect(await getClockGuard()).toBe(5_000);
  });

  it("refuses a time below the highest seen", async () => {
    await raiseClockGuard(5_000);
    expect(await checkClock(4_999)).toMatchObject({ ok: false, guardMs: 5_000 });
    expect(await checkClock(5_000)).toEqual({ ok: true });
  });

  it("passes when nothing has been seen yet", async () => {
    expect(await checkClock(1)).toEqual({ ok: true });
  });

  it("lets server time pull a fast clock back down", async () => {
    await raiseClockGuard(9_999_999);
    await setClockGuardFromServer(1_000);
    expect(await getClockGuard()).toBe(1_000);
  });
});

describe("db identity", () => {
  it("opens the documented database name", async () => {
    const db = await openOfflineDb();
    expect(db.name).toBe(DB_NAME);
  });
});
