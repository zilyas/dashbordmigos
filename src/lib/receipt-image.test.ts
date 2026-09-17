import { describe, expect, it } from "vitest";

import { wrap, receiptFileName, saleToReceipt } from "./receipt-image";
import type { SaleListItem, SaleReceipt } from "@/lib/queries/sales";

/** Stand-in for a canvas context: one "pixel" per character. */
const ctx = { measureText: (t: string) => ({ width: t.length }) } as CanvasRenderingContext2D;

describe("wrap", () => {
  it("keeps text that fits on one line", () => {
    expect(wrap(ctx, "Stussy Tee", 20)).toEqual(["Stussy Tee"]);
  });

  it("breaks on word boundaries when the line overflows", () => {
    expect(wrap(ctx, "Stussy Basic Tee White", 12)).toEqual(["Stussy Basic", "Tee White"]);
  });

  it("never drops a word that is longer than the limit", () => {
    expect(wrap(ctx, "Supercalifragilistic x 1", 5)).toEqual(["Supercalifragilistic", "x 1"]);
  });
});

describe("receiptFileName", () => {
  it("slugifies the store name and keeps the invoice number", () => {
    const receipt = { storeName: "Migos Store!", invoiceNumber: "INV-000010" };
    expect(receiptFileName(receipt as NonNullable<SaleReceipt>)).toBe("Migos-Store-INV-000010.png");
  });

  it("falls back when the store name has no usable characters", () => {
    const receipt = { storeName: "***", invoiceNumber: "INV-000011" };
    expect(receiptFileName(receipt as NonNullable<SaleReceipt>)).toBe("receipt-INV-000011.png");
  });
});

describe("saleToReceipt", () => {
  const sale = {
    id: "s1",
    invoiceNumber: "INV-000015",
    sellerName: "ilyas ouarhim",
    storeName: "migos",
    customerName: null,
    customerPhone: null,
    subtotal: 440,
    discount: 44,
    tax: 0,
    total: 396,
    paymentMethod: "CASH",
    createdAt: "2026-09-17T01:27:00.000Z",
    items: [
      { productName: "Stussy", variantLabel: "S / White", sku: "STU-1", quantity: 2, sellingPrice: 220 },
      { productName: "Cap", variantLabel: null, sku: "CAP-1", quantity: 1, sellingPrice: 100 },
    ],
  } as unknown as SaleListItem;

  it("folds the variant label into the item name and keeps plain names alone", () => {
    const receipt = saleToReceipt(sale, "MAD");
    expect(receipt.items.map((i) => i.name)).toEqual(["Stussy (S / White)", "Cap"]);
  });

  it("carries the store name and the passed currency through", () => {
    const receipt = saleToReceipt(sale, "EUR");
    expect(receipt.storeName).toBe("migos");
    expect(receipt.currency).toBe("EUR");
    expect(receipt.total).toBe(396);
  });
});
