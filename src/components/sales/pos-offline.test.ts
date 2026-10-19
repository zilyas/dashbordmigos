import { describe, it, expect } from "vitest";
import type { CachedProduct, PendingSale } from "@/lib/offline/db";
import { pendingQuantities } from "@/lib/offline/recent-sales";
import type { LeasePayload } from "@/lib/offline/lease";
import {
  describeRecordResult,
  offlineBlockReason,
  offlineCatalogue,
  offlineSaleGate,
} from "@/components/sales/pos-offline";

function product(overrides: Partial<CachedProduct> = {}): CachedProduct {
  return {
    id: "p1",
    sku: "SKU-1",
    barcode: "1111",
    name: "Crème de jour",
    unit: "piece",
    allowDecimalQuantity: false,
    price: 10,
    stock: 5,
    hasVariants: false,
    trackBatch: false,
    variants: [],
    ...overrides,
  };
}

function pending(items: PendingSale["sale"]["items"]): PendingSale {
  return {
    clientSaleId: "c1",
    createdAt: "2026-02-01T10:00:00.000Z",
    expectedTotal: 10,
    lease: "v1.lease.sig",
    sale: { discountPercent: 0, paymentMethod: "CASH", items },
    status: "pending",
    attempts: 0,
  };
}

const payload = { sub: "u1", store: "s1", role: "SELLER", iat: 0, exp: 0 } as unknown as LeasePayload;

describe("offlineBlockReason", () => {
  it("refuses batch-tracked products the sync route would reject", () => {
    expect(offlineBlockReason(product({ trackBatch: true }))).toMatch(/Batch-tracked/);
    expect(offlineBlockReason(product())).toBeNull();
  });
});

describe("offlineCatalogue", () => {
  it("subtracts unsynced quantities from the stock a tile offers", () => {
    const held = pendingQuantities([pending([{ productId: "p1", quantity: 2 }])]);
    const [row] = offlineCatalogue([product()], held, "");
    expect(row.stock).toBe(3);
  });

  it("searches name, SKU, barcode and variant label accent-insensitively", () => {
    const withVariant = product({
      hasVariants: true,
      variants: [{ id: "v1", sku: "SKU-RED", barcode: "2222", label: "Red / L", price: 12, stock: 4 }],
    });
    const held = pendingQuantities([]);
    const hits = (q: string) => offlineCatalogue([withVariant], held, q).length;
    expect(hits("creme")).toBe(1);
    expect(hits("SKU-RED")).toBe(1);
    expect(hits("2222")).toBe(1);
    expect(hits("Red / L")).toBe(1);
    expect(hits("nothing")).toBe(0);
  });

  it("keeps blocked products in the list but marks them", () => {
    const rows = offlineCatalogue([product({ trackBatch: true })], pendingQuantities([]), "");
    expect(rows).toHaveLength(1);
    expect(rows[0].blocked).not.toBeNull();
  });
});

describe("offlineSaleGate", () => {
  it("allows selling while the lease is valid or merely expiring", () => {
    expect(offlineSaleGate({ status: "valid", expiresAt: new Date(), msRemaining: 1, payload }).allowed).toBe(true);
    expect(offlineSaleGate({ status: "expiring", expiresAt: new Date(), msRemaining: 1, payload }).allowed).toBe(true);
  });

  it("blocks an expired lease and names the expiry date", () => {
    const expiresAt = new Date("2026-02-01T10:00:00.000Z");
    const gate = offlineSaleGate({ status: "expired", expiresAt, payload });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.message).toContain(expiresAt.toLocaleString());
  });

  it("blocks a missing or unusable lease", () => {
    expect(offlineSaleGate({ status: "none" }).allowed).toBe(false);
    expect(offlineSaleGate({ status: "invalid", reason: "bad_signature" }).allowed).toBe(false);
  });
});

describe("describeRecordResult", () => {
  it("reports success only for a confirmed local write", () => {
    const toast = describeRecordResult({
      saved: true,
      record: pending([{ productId: "p1", quantity: 1 }]),
    });
    expect(toast).toEqual({ ok: true, message: "Sale saved offline — waiting to sync." });
  });

  it("reports every not-saved reason as a failure so the cart is kept", () => {
    const reasons = ["duplicate", "readback_failed", "write_failed"] as const;
    for (const reason of reasons) {
      expect(describeRecordResult({ saved: false, reason, error: "boom" }).ok).toBe(false);
    }
    expect(describeRecordResult({ saved: false, reason: "no_lease", error: "no permit" }).ok).toBe(false);
    expect(describeRecordResult({ saved: false, reason: "clock_moved_back", error: "clock" }).ok).toBe(false);
  });

  it("tells the cashier a storage failure means do not hand over the goods", () => {
    const toast = describeRecordResult({ saved: false, reason: "write_failed", error: "QuotaExceeded" });
    expect(toast.message).toMatch(/do not hand over/i);
  });
});
