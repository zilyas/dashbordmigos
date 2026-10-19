/**
 * The sync route's job is to be the single real gate on a queued sale, and to
 * tell the till honestly whether a failure is worth retrying.
 *
 * Two mistakes here are expensive and neither is loud: recording a sale whose
 * lease does not hold, and labelling a transient failure terminal so a sale
 * the shop already took cash for is thrown away. Both are covered below.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionMock, verifyLeaseMock, createSaleCoreMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  verifyLeaseMock: vi.fn(),
  createSaleCoreMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({
  logServerError: vi.fn(),
  scopedLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  resolveRequestId: () => "req-test",
}));
vi.mock("@/lib/store-context", () => ({ getSessionContext: sessionMock }));
vi.mock("@/lib/offline/lease-server", () => ({ verifyLeaseForSync: verifyLeaseMock }));
vi.mock("@/lib/sales/create-sale", () => ({ createSaleCore: createSaleCoreMock }));

import { GET, POST } from "@/app/api/pos/offline/sales/route";

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

function body(overrides: Record<string, unknown> = {}) {
  return {
    clientSaleId: UUID,
    lease: "v1.aaa.bbb",
    createdAt: "2026-10-18T10:00:00.000Z",
    expectedTotal: 200,
    sale: {
      customerName: "",
      customerPhone: "",
      discountPercent: 0,
      paymentMethod: "CASH",
      items: [{ productId: "p1", quantity: 1 }],
    },
    ...overrides,
  };
}

const post = (b: unknown = body()) =>
  POST(
    new Request("https://x.test/api/pos/offline/sales", {
      method: "POST",
      body: typeof b === "string" ? b : JSON.stringify(b),
      headers: { "content-type": "application/json" },
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ userId: "u1", role: "MANAGER", storeId: "s1", sid: "sid" });
  verifyLeaseMock.mockResolvedValue({ accepted: true, payload: {} });
  createSaleCoreMock.mockResolvedValue({
    ok: true,
    replayed: false,
    saleId: "sale-1",
    invoiceNumber: "INV-000001",
    total: 200,
  });
});

describe("POST /api/pos/offline/sales", () => {
  it("records a queued sale and passes the till's own timestamp through", async () => {
    const res = await post();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, saleId: "sale-1", replayed: false });

    const [, , options] = createSaleCoreMock.mock.calls[0];
    // The sale is dated when the cashier rang it up, not when it synced —
    // otherwise a week of offline trading all lands on the reconnect day.
    expect(options.createdAt.toISOString()).toBe("2026-10-18T10:00:00.000Z");
    expect(options.clientSaleId).toBe(UUID);
    expect(options.offline).toBe(true);
    expect(options.expectedTotal).toBe(200);
  });

  it("refuses a bad lease BEFORE recording anything", async () => {
    verifyLeaseMock.mockResolvedValue({ accepted: false, reason: "bad_signature" });

    const res = await post();

    expect(res.status).toBe(403);
    // The point of the ordering: a forged lease must not reach the sale path
    // at all, or it banks the sale and argues afterwards.
    expect(createSaleCoreMock).not.toHaveBeenCalled();
  });

  it("does not tell a tamperer which half of the lease failed", async () => {
    verifyLeaseMock.mockResolvedValue({ accepted: false, reason: "bad_signature" });
    const signature = (await (await post()).json()).error.message;

    verifyLeaseMock.mockResolvedValue({ accepted: false, reason: "malformed" });
    const malformed = (await (await post()).json()).error.message;

    expect(signature).toBe(malformed);
  });

  it("reports a replay as success so the till drops its local copy", async () => {
    createSaleCoreMock.mockResolvedValue({
      ok: true,
      replayed: true,
      saleId: "sale-1",
      invoiceNumber: "INV-000001",
      total: 200,
    });

    const json = await (await post()).json();
    expect(json).toMatchObject({ ok: true, replayed: true, saleId: "sale-1" });
  });

  it("surfaces serverTotal on price_changed so the UI can offer a choice", async () => {
    createSaleCoreMock.mockResolvedValue({
      ok: false,
      code: "price_changed",
      message: "The catalogue price moved.",
      serverTotal: 240,
    });

    const res = await post();
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("price_changed");
    expect(json.error.serverTotal).toBe(240);
  });

  /**
   * The retryable/terminal split, asserted as a rule rather than case by case:
   * 5xx means the till retries, 4xx means it stops and shows a human. A code
   * on the wrong side of that line either spins forever or loses a real sale.
   */
  it.each([
    ["idempotency_conflict", 409],
    ["insufficient_stock", 409],
    ["product_unavailable", 404],
    ["store_inactive", 403],
  ])("treats %s as terminal (%i)", async (code, status) => {
    createSaleCoreMock.mockResolvedValue({ ok: false, code, message: "nope" });
    const res = await post();
    expect(res.status).toBe(status);
    expect(res.status).toBeLessThan(500);
  });

  it.each([["invoice_contention"], ["stock_changed"]])(
    "treats %s as retryable (5xx)",
    async (code) => {
      createSaleCoreMock.mockResolvedValue({ ok: false, code, message: "busy" });
      const res = await post();
      // Nothing is wrong with the sale — the till must keep it and try again.
      expect(res.status).toBeGreaterThanOrEqual(500);
    }
  );

  it("leaves the sale pending when something unexpected throws", async () => {
    createSaleCoreMock.mockRejectedValue(new Error("connection terminated"));
    const res = await post();
    expect(res.status).toBe(500);
  });

  it("asks the cashier to sign in again rather than retrying forever", async () => {
    sessionMock.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(401);
    expect(createSaleCoreMock).not.toHaveBeenCalled();
  });

  it("rejects a body that is not a queued sale", async () => {
    const res = await post(body({ clientSaleId: "not-a-uuid" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_body");
    expect(createSaleCoreMock).not.toHaveBeenCalled();
  });

  it("answers a wrong method with JSON 405 and a request id", async () => {
    const res = await GET(new Request("https://x.test/api/pos/offline/sales"));
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});
