import { describe, it, expect } from "vitest";
import {
  computeProfitMargin,
  computeReturnAmounts,
  computeSaleTotals,
  formatInvoiceNumber,
  isValidQuantity,
  resolvePricing,
  round2,
  round3,
  variantLabel,
} from "@/lib/sale-math";

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3); // 0.30000000000000004 -> 0.3
    expect(round2(2.5)).toBe(2.5);
    expect(round2(10)).toBe(10);
    expect(round2(1.239)).toBe(1.24);
  });
});

describe("computeProfitMargin", () => {
  it("computes percentage margin", () => {
    expect(computeProfitMargin(120, 40)).toBeCloseTo(66.6667, 3);
  });
  it("returns 0 when selling price is 0", () => {
    expect(computeProfitMargin(0, 40)).toBe(0);
  });
});

describe("resolvePricing", () => {
  const product = { sellingPrice: 100, fabricationPrice: 40 };
  it("uses product price when variant has no overrides", () => {
    expect(resolvePricing(product, { sellingPrice: null, fabricationPrice: null })).toEqual({
      sellingPrice: 100,
      fabricationPrice: 40,
    });
  });
  it("uses variant overrides when present", () => {
    expect(resolvePricing(product, { sellingPrice: 150, fabricationPrice: 55 })).toEqual({
      sellingPrice: 150,
      fabricationPrice: 55,
    });
  });
  it("falls back to product when variant is null/undefined", () => {
    expect(resolvePricing(product, null)).toEqual({ sellingPrice: 100, fabricationPrice: 40 });
    expect(resolvePricing(product)).toEqual({ sellingPrice: 100, fabricationPrice: 40 });
  });
  it("mixes an override with a fallback", () => {
    expect(resolvePricing(product, { sellingPrice: 150, fabricationPrice: null })).toEqual({
      sellingPrice: 150,
      fabricationPrice: 40,
    });
  });
});

describe("variantLabel", () => {
  it("joins size and color", () => {
    expect(variantLabel("M", "Noir")).toBe("M / Noir");
  });
  it("handles a single axis", () => {
    expect(variantLabel("M", null)).toBe("M");
    expect(variantLabel(null, "Noir")).toBe("Noir");
  });
  it("returns null when both are missing", () => {
    expect(variantLabel(null, null)).toBeNull();
    expect(variantLabel("", "")).toBeNull();
  });
});

describe("computeSaleTotals", () => {
  it("computes subtotal, discount, tax, total and profit", () => {
    // 2 x (100 sell / 40 cost) = subtotal 200, 10% discount = 20, taxable 180,
    // 20% tax = 36, total 216. Item profit 2*60=120, netProfit 120-20=100.
    const t = computeSaleTotals(
      [{ sellingPrice: 100, fabricationPrice: 40, quantity: 2 }],
      10,
      20
    );
    expect(t).toEqual({
      subtotal: 200,
      discount: 20,
      tax: 36,
      total: 216,
      netProfit: 100,
      itemProfitTotal: 120,
    });
  });

  it("handles zero discount and zero tax", () => {
    const t = computeSaleTotals([{ sellingPrice: 50, fabricationPrice: 30, quantity: 3 }], 0, 0);
    expect(t.subtotal).toBe(150);
    expect(t.total).toBe(150);
    expect(t.netProfit).toBe(60);
  });
});

describe("computeReturnAmounts", () => {
  const sale = { subtotal: 200, discount: 20, tax: 36 };

  it("refunds a full return to exactly the paid total", () => {
    const r = computeReturnAmounts(sale, [
      { sellingPrice: 100, fabricationPrice: 40, quantity: 2 },
    ]);
    // Full return: gross 200, discount 20, tax 36 -> refund 216 (== sale total).
    expect(r.returnedGross).toBe(200);
    expect(r.returnedDiscount).toBe(20);
    expect(r.returnedTax).toBe(36);
    expect(r.refundAmount).toBe(216);
    expect(r.returnedProfit).toBe(100);
  });

  it("refunds a partial return proportionally", () => {
    const r = computeReturnAmounts(sale, [
      { sellingPrice: 100, fabricationPrice: 40, quantity: 1 },
    ]);
    // Half the sale: discount 10, tax 18, refund 100-10+18 = 108.
    expect(r.returnedGross).toBe(100);
    expect(r.returnedDiscount).toBe(10);
    expect(r.returnedTax).toBe(18);
    expect(r.refundAmount).toBe(108);
    expect(r.returnedProfit).toBe(50);
  });

  it("handles a zero-subtotal sale without dividing by zero", () => {
    const r = computeReturnAmounts({ subtotal: 0, discount: 0, tax: 0 }, [
      { sellingPrice: 0, fabricationPrice: 0, quantity: 1 },
    ]);
    expect(r.refundAmount).toBe(0);
  });
});

describe("formatInvoiceNumber", () => {
  it("zero-pads to 6 digits", () => {
    expect(formatInvoiceNumber(1)).toBe("INV-000001");
    expect(formatInvoiceNumber(123456)).toBe("INV-123456");
    expect(formatInvoiceNumber(1234567)).toBe("INV-1234567");
  });
});

// ---- Cross-phase integration: one variant with Size/Color + custom axis,
//      sold in a decimal quantity, then partially returned. ----

describe("combined variant (Size/Color + custom axis + decimal quantity)", () => {
  it("builds a single well-formed label from all axes (no duplication)", () => {
    // Phase 3 label build: variantLabel(size, color, [axisValues]).
    expect(variantLabel("M", "Blanc", ["Regular"])).toBe("M / Blanc / Regular");
    expect(variantLabel("S", "Noir", ["Slim"])).toBe("S / Noir / Slim");
  });

  it("computes totals for a fractional-kg quantity of the variant", () => {
    // 1.5 kg at 90 (cost 30), 20% tax, no discount.
    const t = computeSaleTotals(
      [{ sellingPrice: 90, fabricationPrice: 30, quantity: 1.5 }],
      0,
      20
    );
    expect(t.subtotal).toBe(135);
    expect(t.tax).toBe(27);
    expect(t.total).toBe(162);
    expect(t.netProfit).toBe(90); // (90-30) * 1.5
  });

  it("computes a partial fractional return of the variant line", () => {
    // Return 0.5 kg of the 1.5 kg line (leaves 1.0 kg outstanding).
    const sale = { subtotal: 135, discount: 0, tax: 27 };
    const r = computeReturnAmounts(sale, [
      { sellingPrice: 90, fabricationPrice: 30, quantity: 0.5 },
    ]);
    expect(r.returnedGross).toBe(45); // 0.5 * 90
    expect(r.returnedTax).toBe(9); // 27 * (45/135)
    expect(r.refundAmount).toBe(54); // 45 - 0 + 9
    expect(r.returnedProfit).toBe(30); // (90-30) * 0.5
    expect(round3(1.5 - 0.5)).toBe(1); // outstanding
  });
});

// ---- Phase 1b: decimal quantities ----

describe("round3", () => {
  it("rounds to three decimals and removes float noise", () => {
    expect(round3(0.1 + 0.2)).toBe(0.3);
    expect(round3(1.2349)).toBe(1.235);
    expect(round3(0.5)).toBe(0.5);
    expect(round3(2)).toBe(2);
  });
});

describe("isValidQuantity", () => {
  it("accepts positive integers in both modes", () => {
    expect(isValidQuantity(1, false)).toBe(true);
    expect(isValidQuantity(3, true)).toBe(true);
  });
  it("rejects zero and negatives", () => {
    expect(isValidQuantity(0, true)).toBe(false);
    expect(isValidQuantity(-1, true)).toBe(false);
  });
  it("rejects decimals when not allowed (integer fallback)", () => {
    expect(isValidQuantity(0.5, false)).toBe(false);
    expect(isValidQuantity(1.25, false)).toBe(false);
  });
  it("accepts decimals when allowed", () => {
    expect(isValidQuantity(0.5, true)).toBe(true);
    expect(isValidQuantity(1.25, true)).toBe(true);
  });
  it("rejects non-finite values", () => {
    expect(isValidQuantity(NaN, true)).toBe(false);
    expect(isValidQuantity(Infinity, true)).toBe(false);
  });
});

describe("computeSaleTotals with decimal quantity", () => {
  it("prices a fractional-kg line correctly", () => {
    // 0.5 kg at 100/kg (cost 40): subtotal 50, no discount, 20% tax = 10,
    // total 60. Profit 0.5*60 = 30.
    const t = computeSaleTotals(
      [{ sellingPrice: 100, fabricationPrice: 40, quantity: 0.5 }],
      0,
      20
    );
    expect(t.subtotal).toBe(50);
    expect(t.tax).toBe(10);
    expect(t.total).toBe(60);
    expect(t.netProfit).toBe(30);
  });

  it("mixes a fractional and an integer line", () => {
    const t = computeSaleTotals(
      [
        { sellingPrice: 20, fabricationPrice: 12, quantity: 1.5 }, // 30
        { sellingPrice: 10, fabricationPrice: 6, quantity: 2 }, // 20
      ],
      0,
      0
    );
    expect(t.subtotal).toBe(50);
    expect(t.total).toBe(50);
    expect(t.netProfit).toBe(round2(1.5 * 8 + 2 * 4)); // 12 + 8 = 20
  });
});

describe("computeReturnAmounts with decimal quantity", () => {
  it("refunds a fractional partial return proportionally", () => {
    // Sale of 2 kg at 100 (subtotal 200, tax 40, no discount). Return 0.5 kg.
    const sale = { subtotal: 200, discount: 0, tax: 40 };
    const r = computeReturnAmounts(sale, [
      { sellingPrice: 100, fabricationPrice: 40, quantity: 0.5 },
    ]);
    expect(r.returnedGross).toBe(50); // 0.5 * 100
    expect(r.returnedTax).toBe(10); // 40 * (50/200)
    expect(r.refundAmount).toBe(60); // 50 - 0 + 10
    expect(r.returnedProfit).toBe(30); // 0.5 * 60
  });

  it("returns 0.3 kg out of a 1.2 kg line (leaves 0.9 kg outstanding)", () => {
    // 1.2 kg at 100 (cost 40): subtotal 120, tax 20% = 24, no discount.
    const sale = { subtotal: 120, discount: 0, tax: 24 };
    const r = computeReturnAmounts(sale, [
      { sellingPrice: 100, fabricationPrice: 40, quantity: 0.3 },
    ]);
    expect(r.returnedGross).toBe(30); // 0.3 * 100
    expect(r.returnedTax).toBe(6); // 24 * (30/120)
    expect(r.refundAmount).toBe(36); // 30 - 0 + 6
    expect(r.returnedProfit).toBe(18); // (100-40) * 0.3
    // Outstanding after this partial return: 1.2 - 0.3 = 0.9 (handled by the
    // action via returnedQuantity increment + round3 remaining).
    expect(round3(1.2 - 0.3)).toBe(0.9);
  });
});
