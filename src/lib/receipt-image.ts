import { formatCurrency, formatDateTime } from "@/lib/format";
import type { SaleListItem, SaleReceipt } from "@/lib/queries/sales";

/**
 * Every label this canvas draws, pre-resolved by the caller via
 * useTranslations("receipt") + useTranslations("labels") -- this file has no
 * hooks/JSX, so it cannot call next-intl itself. Keys match receipt.json 1:1;
 * this is the same receipt shown on-screen (receipt.tsx), just drawn to a
 * canvas instead of the DOM, so the two must never show different languages.
 */
export type ReceiptImageLabels = {
  invoice: string;
  servedBy: string;
  customer: string;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  paymentMethod: string;
  thankYou: string;
};

/**
 * Draws the receipt onto a canvas and returns a PNG blob.
 *
 * Rendering to an image rather than printing the DOM is deliberate: the receipt
 * lives inside a Radix dialog that is `position: fixed` and translated by -50%,
 * under a `body` that is a flex column and an `html` that sets `overflow-x:
 * clip`. Every print-CSS attempt to undo that fought the app's own layout and
 * lost. A canvas carries none of it, and the same PNG is what gets shared to
 * WhatsApp — so print and share cannot drift apart.
 *
 * 576 px is the pixel width of an 80 mm thermal roll at 203 dpi, and it scales
 * down cleanly to 58 mm. On A4 the print window stretches it to the page width.
 */
const WIDTH = 576;
const PAD = 32;
const INNER = WIDTH - PAD * 2;
const LINE = 30;
const GAP = 18;

type Ctx = CanvasRenderingContext2D;

const font = (size: number, weight = "normal") =>
  `${weight} ${size}px "Courier New", ui-monospace, monospace`;

/** Splits `text` into lines that each fit `max` px under the current font. */
export function wrap(ctx: Ctx, text: string, max: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function renderReceiptImage(
  receipt: NonNullable<SaleReceipt>,
  paymentMethodLabel: string,
  labels: ReceiptImageLabels
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas is not available in this browser."));

  // Two passes: measure with a throwaway height, then draw at the real height.
  // Item names wrap, so the height is not known until the text is laid out.
  const draw = (measureOnly: boolean) => {
    let y = PAD;

    const center = (text: string, size: number, weight = "normal", color = "#000") => {
      ctx.font = font(size, weight);
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      if (!measureOnly) ctx.fillText(text, WIDTH / 2, y);
      y += LINE;
    };

    const row = (left: string, right: string, size = 20, weight = "normal", color = "#000") => {
      ctx.font = font(size, weight);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      if (!measureOnly) ctx.fillText(left, PAD, y);
      ctx.textAlign = "right";
      if (!measureOnly) ctx.fillText(right, WIDTH - PAD, y);
      y += LINE;
    };

    const rule = (dashed: boolean) => {
      y += GAP / 2;
      if (!measureOnly) {
        ctx.strokeStyle = "#999";
        ctx.lineWidth = 1;
        ctx.setLineDash(dashed ? [6, 6] : []);
        ctx.beginPath();
        ctx.moveTo(PAD, y);
        ctx.lineTo(WIDTH - PAD, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      y += GAP;
    };

    center(receipt.storeName, 26, "bold");
    center(formatDateTime(receipt.createdAt), 18, "normal", "#666");
    y += GAP / 2;

    row(labels.invoice, receipt.invoiceNumber, 18, "normal", "#666");
    row(labels.servedBy, receipt.sellerName, 18, "normal", "#666");
    if (receipt.customerName) row(labels.customer, receipt.customerName, 18, "normal", "#666");

    rule(true);

    for (const item of receipt.items) {
      const price = formatCurrency(item.sellingPrice * item.quantity, receipt.currency);
      ctx.font = font(20);
      const priceWidth = ctx.measureText(price).width;
      const label = `${item.name} x ${item.quantity}`;
      const lines = wrap(ctx, label, INNER - priceWidth - 16);
      lines.forEach((line, i) => {
        // Price sits on the first line of a wrapped name, aligned right.
        row(line, i === 0 ? price : "");
      });
    }

    rule(true);

    row(labels.subtotal, formatCurrency(receipt.subtotal, receipt.currency));
    if (receipt.discount > 0) {
      row(labels.discount, `-${formatCurrency(receipt.discount, receipt.currency)}`);
    }
    row(labels.tax, formatCurrency(receipt.tax, receipt.currency));
    rule(false);
    row(labels.total, formatCurrency(receipt.total, receipt.currency), 26, "bold");

    rule(true);

    row(labels.paymentMethod, paymentMethodLabel, 18, "normal", "#666");
    y += GAP / 2;
    center(labels.thankYou, 18, "normal", "#666");

    return y + PAD;
  };

  canvas.width = WIDTH;
  canvas.height = 2000;
  const height = draw(true);

  canvas.width = WIDTH;
  canvas.height = Math.ceil(height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, WIDTH, canvas.height);
  ctx.textBaseline = "top";
  draw(false);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the receipt image."))),
      "image/png"
    );
  });
}

export function receiptFileName(receipt: NonNullable<SaleReceipt>) {
  const store = receipt.storeName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `${store || "receipt"}-${receipt.invoiceNumber}.png`;
}

/**
 * Rebuilds a printable receipt from a saved sale row.
 *
 * `SaleListItem` already carries every line of the sale (the return dialog
 * needs it), so reprinting an old invoice costs no extra query. Currency is not
 * on the row — it is a store setting, so the caller passes it down.
 */
export function saleToReceipt(
  sale: SaleListItem,
  currency: string
): NonNullable<SaleReceipt> {
  return {
    id: sale.id,
    invoiceNumber: sale.invoiceNumber,
    sellerName: sale.sellerName,
    customerName: sale.customerName,
    customerPhone: sale.customerPhone,
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.total,
    paymentMethod: sale.paymentMethod,
    createdAt: sale.createdAt,
    storeName: sale.storeName,
    currency,
    items: sale.items.map((item) => ({
      name: item.variantLabel ? `${item.productName} (${item.variantLabel})` : item.productName,
      sku: item.sku,
      quantity: item.quantity,
      sellingPrice: item.sellingPrice,
    })),
  };
}
