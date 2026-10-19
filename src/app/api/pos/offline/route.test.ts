/**
 * The snapshot is cached on a shop-floor device that anyone can pick up and
 * open devtools on. Two things must never reach it: cost prices, which hand a
 * competitor (or an employee) every margin in the shop, and image URLs, which
 * balloon a cache the offline UI renders as text anyway.
 *
 * The leak tests below assert ABSENCE. A test that only checks the good fields
 * are present passes happily while `fabricationPrice` rides along beside them,
 * which is exactly the failure worth guarding.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, sessionMock, getSalesMock, issueLeaseMock, enabledMock, publicKeyMock } = vi.hoisted(
  () => ({
    db: {
      product: { findMany: vi.fn() },
      variantAxisDefinition: { findMany: vi.fn(async () => []) },
    },
    sessionMock: vi.fn(),
    getSalesMock: vi.fn(async (): Promise<Record<string, unknown>[]> => []),
    issueLeaseMock: vi.fn(),
    enabledMock: vi.fn(() => true),
    publicKeyMock: vi.fn(async (): Promise<string | null> => "PUBLIC_KEY_B64"),
  })
);

vi.mock("@/lib/prisma", () => ({ prisma: db }));
// `scopedLogger` is needed too: api/auth.ts pulls in rate-limit.ts, which
// calls it at module scope, so a partial mock throws before any test runs.
vi.mock("@/lib/logger", () => ({
  logServerError: vi.fn(),
  scopedLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  resolveRequestId: () => "req-test",
}));
vi.mock("@/lib/store-context", () => ({ getSessionContext: sessionMock }));
vi.mock("@/lib/queries/sales", () => ({ getSales: getSalesMock }));
vi.mock("@/lib/queries/settings", () => ({
  getStoreSettings: vi.fn(async () => ({
    storeName: "Migos",
    currency: "MAD",
    taxRate: 0,
    features: { units_enabled: false },
  })),
}));
vi.mock("@/lib/offline/lease-server", () => ({
  offlineLeaseEnabled: enabledMock,
  issueLease: issueLeaseMock,
  getOfflineLeasePublicKeyBase64: publicKeyMock,
}));

import { GET, POST } from "@/app/api/pos/offline/route";

/** A product row shaped as the route's own `select` produces it. */
function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    sku: "S-01",
    barcode: "123",
    name: "sweeter",
    unit: "piece",
    allowDecimalQuantity: false,
    sellingPrice: 200,
    stock: 0,
    hasVariants: true,
    trackBatch: false,
    variants: [
      {
        id: "v1",
        sku: "S-01-M-BLACK",
        barcode: null,
        sellingPrice: null,
        stock: 10,
        axisValues: null,
        size: { name: "M" },
        color: { name: "Black" },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  enabledMock.mockReturnValue(true);
  publicKeyMock.mockResolvedValue("PUBLIC_KEY_B64");
  issueLeaseMock.mockResolvedValue({ ok: true, token: "v1.aaa.bbb" });
  sessionMock.mockResolvedValue({ userId: "u1", role: "MANAGER", storeId: "s1", sid: "sid" });
  db.product.findMany.mockResolvedValue([productRow()]);
  db.variantAxisDefinition.findMany.mockResolvedValue([]);
  getSalesMock.mockResolvedValue([]);
});

const req = () => new Request("https://x.test/api/pos/offline");

describe("GET /api/pos/offline", () => {
  it("never ships a cost price or an image to the device", async () => {
    const body = await (await GET(req())).json();
    const serialized = JSON.stringify(body);

    // Checked on the serialized payload, not field by field: a nested leak
    // three levels down would slip past a per-key assertion.
    for (const banned of ["fabricationPrice", "profitMargin", "imageUrl", "images", "cost"]) {
      expect(serialized).not.toContain(banned);
    }
    // The query itself must not even ask for them.
    const select = db.product.findMany.mock.calls[0][0].select;
    expect(select.fabricationPrice).toBeUndefined();
    expect(select.variants.select.imageUrl).toBeUndefined();
  });

  it("reports variant stock as the live sum, not the stale parent column", async () => {
    db.product.findMany.mockResolvedValue([
      productRow({
        stock: 0,
        variants: [
          { ...productRow().variants[0], id: "v1", stock: 10 },
          { ...productRow().variants[0], id: "v2", stock: 9 },
        ],
      }),
    ]);

    const body = await (await GET(req())).json();
    // The parent column says 0 and is never written for a variant product
    // (2b29cc5). Caching it would make the till refuse to sell stock it has.
    expect(body.products[0].stock).toBe(19);
  });

  it("labels a variant for the UI instead of showing a SKU", async () => {
    const body = await (await GET(req())).json();
    expect(body.products[0].variants[0].label).toBe("M / Black");
  });

  it("still serves a usable snapshot when lease keys are unset", async () => {
    // An un-configured deployment must keep working online. Offline selling is
    // simply unavailable; the route does not fail.
    enabledMock.mockReturnValue(false);
    publicKeyMock.mockResolvedValue(null);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.lease).toBeNull();
    expect(body.publicKey).toBeNull();
    expect(body.products).toHaveLength(1);
    expect(issueLeaseMock).not.toHaveBeenCalled();
  });

  it("caps recent sales at 10", async () => {
    getSalesMock.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({
        id: `s${i}`,
        invoiceNumber: `INV-${i}`,
        total: 10,
        createdAt: "2026-10-18T00:00:00.000Z",
        customerName: null,
        paymentMethod: "CASH",
        itemCount: 1,
      }))
    );

    const body = await (await GET(req())).json();
    expect(body.recentSales).toHaveLength(10);
  });

  it("refuses an unauthenticated request", async () => {
    sessionMock.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("answers a wrong method with JSON 405 and a request id", async () => {
    const res = await POST(new Request("https://x.test/api/pos/offline", { method: "POST" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect((await res.json()).error.code).toBe("method_not_allowed");
  });
});
