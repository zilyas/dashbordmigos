/**
 * Pure sale/return arithmetic and variant-pricing resolution. No Prisma, no
 * I/O — kept side-effect free so it is unit-testable and reusable by both the
 * sale-creation and return flows in `src/actions/sales.ts`.
 */

export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Rounds a quantity to 3 decimals — matches the DB Decimal(12,3) columns and
 * removes binary-float noise (e.g. 0.1 + 0.2). Money stays on {@link round2}.
 */
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Validates a sale/stock quantity. Must be finite and > 0. When decimals are
 * not allowed for the product (the default), it must also be a whole number —
 * this is what keeps piece-based products behaving exactly as before.
 */
export function isValidQuantity(qty: number, allowDecimal: boolean): boolean {
  if (!Number.isFinite(qty) || qty <= 0) return false;
  if (!allowDecimal && !Number.isInteger(qty)) return false;
  return true;
}

export function computeProfitMargin(sellingPrice: number, fabricationPrice: number): number {
  if (sellingPrice <= 0) return 0;
  return ((sellingPrice - fabricationPrice) / sellingPrice) * 100;
}

/**
 * Resolves the effective selling/fabrication price for a line. A variant's
 * override wins when present; otherwise the parent product's price applies.
 * `null`/`undefined` overrides fall through to the product value.
 */
export function resolvePricing(
  product: { sellingPrice: number; fabricationPrice: number },
  variant?: { sellingPrice: number | null; fabricationPrice: number | null } | null
): { sellingPrice: number; fabricationPrice: number } {
  return {
    sellingPrice: variant?.sellingPrice ?? product.sellingPrice,
    fabricationPrice: variant?.fabricationPrice ?? product.fabricationPrice,
  };
}

/** Joins non-empty parts into a "A / B / C" label, or null if none. */
export function variantLabelFromParts(parts: (string | null | undefined)[]): string | null {
  const clean = parts.filter((p): p is string => !!p && p.length > 0);
  return clean.length > 0 ? clean.join(" / ") : null;
}

/**
 * Human-readable variant snapshot. Built-in Size/Color first, then any custom
 * axis values (already ordered), e.g. "M / Noir", "256GB / Blue", or null.
 */
export function variantLabel(
  sizeName?: string | null,
  colorName?: string | null,
  axisValues: string[] = []
): string | null {
  return variantLabelFromParts([sizeName, colorName, ...axisValues]);
}

export type SaleLineInput = {
  sellingPrice: number;
  fabricationPrice: number;
  quantity: number;
};

export type SaleTotals = {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  netProfit: number;
  itemProfitTotal: number;
};

/**
 * Computes the money columns for a sale from its priced lines. Discount is a
 * percentage of subtotal; tax is applied to the discounted (taxable) amount.
 * Every figure is rounded to 2 decimals, matching the DB Decimal(10,2) columns.
 */
export function computeSaleTotals(
  lines: SaleLineInput[],
  discountPercent: number,
  taxRatePercent: number
): SaleTotals {
  let subtotal = 0;
  let itemProfitTotal = 0;
  for (const line of lines) {
    subtotal += line.sellingPrice * line.quantity;
    itemProfitTotal += (line.sellingPrice - line.fabricationPrice) * line.quantity;
  }
  const discount = round2(subtotal * (discountPercent / 100));
  const taxable = subtotal - discount;
  const tax = round2(taxable * (taxRatePercent / 100));
  const total = round2(taxable + tax);
  const netProfit = round2(itemProfitTotal - discount);
  return { subtotal: round2(subtotal), discount, tax, total, netProfit, itemProfitTotal };
}

export type ReturnLine = {
  sellingPrice: number;
  fabricationPrice: number;
  quantity: number;
};

export type ReturnAmounts = {
  returnedGross: number;
  returnedDiscount: number;
  returnedTax: number;
  refundAmount: number;
  returnedProfit: number;
};

/**
 * Computes the proportional refund for a set of returned lines. Discount and
 * tax are refunded in the same proportion the returned gross bears to the
 * original subtotal, so a full return nets exactly to zero.
 */
export function computeReturnAmounts(
  sale: { subtotal: number; discount: number; tax: number },
  lines: ReturnLine[]
): ReturnAmounts {
  const returnedGross = lines.reduce((sum, l) => sum + l.sellingPrice * l.quantity, 0);
  const shareOfSale = sale.subtotal > 0 ? returnedGross / sale.subtotal : 0;
  const returnedDiscount = round2(sale.discount * shareOfSale);
  const returnedTax = round2(sale.tax * shareOfSale);
  const refundAmount = round2(returnedGross - returnedDiscount + returnedTax);
  const returnedProfit = round2(
    lines.reduce((sum, l) => sum + (l.sellingPrice - l.fabricationPrice) * l.quantity, 0) -
      returnedDiscount
  );
  return {
    returnedGross: round2(returnedGross),
    returnedDiscount,
    returnedTax,
    refundAmount,
    returnedProfit,
  };
}

/** Zero-padded per-store invoice number, e.g. 7 -> "INV-000007". */
export function formatInvoiceNumber(sequence: number): string {
  return `INV-${String(sequence).padStart(6, "0")}`;
}
