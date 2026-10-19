import { describe, it, expect } from "vitest";
import type { CachedProduct, CachedRecentSale, PendingSale } from "@/lib/offline/db";
import {
  LEASE_EXPIRY_WARNING_MS,
  displayedStock,
  displayedStockFor,
  leaseStateFrom,
  mergeRecentSales,
  pendingQuantities,
} from "@/lib/offline/recent-sales";
import type { LeasePayload } from "@/lib/offline/lease";

function serverSale(id: string, minute: number): CachedRecentSale {
  return {
    id,
    invoiceNumber: `INV-${id}`,
    total: 10,
    createdAt: `2026-02-01T10:${String(minute).padStart(2, "0")}:00.000Z`,
    customerName: null,
    paymentMethod: "CASH",
    itemCount: 1,
  };
}

function pendingSale(
  clientSaleId: string,
  minute: number,
  overrides: Partial<PendingSale> = {}
): PendingSale {
  return {
    clientSaleId,
    createdAt: `2026-02-01T10:${String(minute).padStart(2, "0")}:00.000Z`,
    expectedTotal: 25,
    lease: "v1.lease.sig",
    sale: { discountPercent: 0, paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] },
    status: "pending",
    attempts: 0,
    ...overrides,
  };
}

describe("mergeRecentSales", () => {
  it("puts the newest first", () => {
    const rows = mergeRecentSales([serverSale("s1", 5), serverSale("s2", 20)], []);
    expect(rows.map((r) => r.key)).toEqual(["s2", "s1"]);
  });

  it("caps at 10", () => {
    const server = Array.from({ length: 8 }, (_, i) => serverSale(`s${i}`, i));
    const local = Array.from({ length: 8 }, (_, i) => pendingSale(`c${i}`, 30 + i));
    const rows = mergeRecentSales(server, local);
    expect(rows).toHaveLength(10);
    // The 10 newest are the 8 local ones plus the two newest server ones.
    expect(rows.filter((r) => r.state === "pending")).toHaveLength(8);
  });

  it("de-duplicates on clientSaleId", () => {
    const local = pendingSale("c1", 10, { status: "synced", serverSaleId: "s1" });
    const rows = mergeRecentSales([serverSale("s1", 10)], [local, local]);
    expect(rows).toHaveLength(1);
    expect(rows[0].clientSaleId).toBe("c1");
  });

  it("de-duplicates a synced sale against the server copy via serverSaleId", () => {
    // The exact shape that makes a cashier think they charged twice: the drain
    // confirmed the sale, the snapshot now lists it, and the local record is
    // still there waiting to be pruned.
    const rows = mergeRecentSales(
      [serverSale("s1", 10), serverSale("s2", 11)],
      [pendingSale("c1", 10, { status: "synced", serverSaleId: "s1", invoiceNumber: "INV-s1" })]
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.key)).toEqual(["s2", "c1"]);
  });

  it("marks terminal failures for review and keeps queued sales pending", () => {
    const rows = mergeRecentSales(
      [],
      [
        pendingSale("c1", 10, { status: "review" }),
        pendingSale("c2", 11),
        pendingSale("c3", 12, { status: "synced", serverSaleId: "s9" }),
      ]
    );
    expect(rows.map((r) => r.state)).toEqual(["synced", "pending", "review"]);
  });
});

describe("displayedStock", () => {
  const plain: CachedProduct = {
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
  };

  const varianted: CachedProduct = {
    ...plain,
    id: "p2",
    hasVariants: true,
    stock: 0,
    variants: [
      { id: "v1", sku: "S-1", barcode: null, label: "S", price: 100, stock: 3 },
      { id: "v2", sku: "S-2", barcode: null, label: "M", price: 100, stock: 4 },
    ],
  };

  it("subtracts quantities held by unsynced sales", () => {
    const held = pendingQuantities([
      pendingSale("c1", 10, {
        sale: {
          discountPercent: 0,
          paymentMethod: "CASH",
          items: [{ productId: "p1", quantity: 2 }],
        },
      }),
    ]);
    expect(displayedStock(plain, held).stock).toBe(3);
  });

  it("still subtracts a sale parked in review: the goods left the shop", () => {
    const held = pendingQuantities([pendingSale("c1", 10, { status: "review" })]);
    expect(displayedStock(plain, held).stock).toBe(4);
  });

  it("ignores synced sales, whose decrement the next snapshot already carries", () => {
    const held = pendingQuantities([
      pendingSale("c1", 10, { status: "synced", serverSaleId: "s1" }),
    ]);
    expect(displayedStock(plain, held).stock).toBe(5);
  });

  it("subtracts per variant and sums the parent from the variants", () => {
    const held = pendingQuantities([
      pendingSale("c1", 10, {
        sale: {
          discountPercent: 0,
          paymentMethod: "CASH",
          items: [{ productId: "p2", variantId: "v1", quantity: 2 }],
        },
      }),
    ]);
    const computed = displayedStock(varianted, held);
    expect(computed.variants.get("v1")).toBe(1);
    expect(computed.variants.get("v2")).toBe(4);
    expect(computed.stock).toBe(5);
    expect(displayedStockFor(varianted, held, "v1")).toBe(1);
  });

  it("floors at zero rather than printing a negative count", () => {
    const held = pendingQuantities([
      pendingSale("c1", 10, {
        sale: {
          discountPercent: 0,
          paymentMethod: "CASH",
          items: [{ productId: "p1", quantity: 99 }],
        },
      }),
    ]);
    expect(displayedStock(plain, held).stock).toBe(0);
  });
});

describe("leaseStateFrom", () => {
  const now = new Date("2026-02-01T10:00:00.000Z");
  function payload(expMs: number): LeasePayload {
    return {
      v: 1,
      sub: "user-1",
      storeId: "store-1",
      role: "SELLER",
      iat: Math.floor(now.getTime() / 1000) - 60,
      exp: Math.floor(expMs / 1000),
    };
  }

  it("reports none with no lease at all", () => {
    expect(leaseStateFrom(null, now)).toEqual({ status: "none" });
  });

  it("reports valid well before expiry", () => {
    const state = leaseStateFrom(
      { status: "valid", payload: payload(now.getTime() + 5 * 24 * 3600_000) },
      now
    );
    expect(state.status).toBe("valid");
  });

  it("reports expiring inside the warning window, with the date", () => {
    const expiresMs = now.getTime() + LEASE_EXPIRY_WARNING_MS - 1000;
    const state = leaseStateFrom({ status: "valid", payload: payload(expiresMs) }, now);
    expect(state.status).toBe("expiring");
    if (state.status === "expiring") {
      expect(state.expiresAt.getTime()).toBe(Math.floor(expiresMs / 1000) * 1000);
      expect(state.msRemaining).toBeGreaterThan(0);
    }
  });

  it("reports expired with the expiry date the server gave", () => {
    const expiresAt = new Date("2026-01-30T10:00:00.000Z");
    const state = leaseStateFrom(
      { status: "expired", payload: payload(expiresAt.getTime()), expiresAt },
      now
    );
    expect(state).toMatchObject({ status: "expired", expiresAt });
  });

  it("collapses tampered and mismatched leases into one invalid state", () => {
    expect(leaseStateFrom({ status: "bad_signature" }, now)).toEqual({
      status: "invalid",
      reason: "bad_signature",
    });
    expect(leaseStateFrom({ status: "malformed", reason: "x" }, now)).toEqual({
      status: "invalid",
      reason: "malformed",
    });
  });
});
