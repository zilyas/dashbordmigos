import { prisma } from "@/lib/prisma";
import { reconcileBatchStock, batchExpiryState, type ReconcileResult, type BatchExpiryState } from "@/lib/batches";
import { getTodayInTimezone, toDateKey } from "@/lib/timezone";
import { variantLabelFromParts } from "@/lib/sale-math";

/**
 * Store-scoped batch read models for the Manager batch-inventory UI and
 * reconciliation tools. Every function takes the session-derived `storeId` and
 * filters by it — callers must never pass a client-supplied store id.
 */

export type BatchRow = {
  id: string;
  batchCode: string;
  variantId: string | null;
  variantLabel: string | null;
  stock: number;
  costPrice: number | null;
  status: "ACTIVE" | "DEPLETED" | "EXPIRED" | "ARCHIVED";
  receivedAt: string;
  /** Date-only key (YYYY-MM-DD) or null; never timezone-shifted. */
  expiryDate: string | null;
  /** Derived display/enforcement state against the store-local today. */
  expiryState: BatchExpiryState;
};

export type ReconciliationLine = ReconcileResult & {
  scope: "product" | "variant";
  variantId: string | null;
  label: string;
};

export type ProductBatchView = {
  productId: string;
  productName: string;
  hasVariants: boolean;
  trackBatch: boolean;
  trackExpiry: boolean;
  storeToday: string;
  unit: string;
  allowDecimalQuantity: boolean;
  variants: { id: string; label: string; sku: string; aggregateStock: number }[];
  batches: BatchRow[];
  reconciliation: { ok: boolean; lines: ReconciliationLine[] };
};

function variantLabelOf(size: string | null | undefined, color: string | null | undefined, sku: string) {
  return variantLabelFromParts([size, color]) || sku;
}

/**
 * Full batch view for one product (edit page batch section). Returns null when
 * the product isn't in the store. Includes per-product/variant reconciliation.
 */
export async function getProductBatchView(
  productId: string,
  storeId: string
): Promise<ProductBatchView | null> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { timezone: true } });
  const storeToday = getTodayInTimezone(store.timezone);

  const product = await prisma.product.findFirst({
    where: { id: productId, storeId },
    select: {
      id: true,
      name: true,
      hasVariants: true,
      trackBatch: true,
      trackExpiry: true,
      unit: true,
      allowDecimalQuantity: true,
      stock: true,
      variants: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          sku: true,
          stock: true,
          size: { select: { name: true } },
          color: { select: { name: true } },
        },
      },
      batches: {
        orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          batchCode: true,
          variantId: true,
          stock: true,
          costPrice: true,
          status: true,
          receivedAt: true,
          expiryDate: true,
        },
      },
    },
  });
  if (!product) return null;

  const variantMeta = new Map(
    product.variants.map((v) => [v.id, variantLabelOf(v.size?.name, v.color?.name, v.sku)])
  );

  const batches: BatchRow[] = product.batches.map((b) => ({
    id: b.id,
    batchCode: b.batchCode,
    variantId: b.variantId,
    variantLabel: b.variantId ? variantMeta.get(b.variantId) ?? null : null,
    stock: Number(b.stock),
    costPrice: b.costPrice != null ? Number(b.costPrice) : null,
    status: b.status,
    receivedAt: b.receivedAt.toISOString(),
    expiryDate: b.expiryDate ? toDateKey(b.expiryDate) : null,
    expiryState: batchExpiryState(b.expiryDate, storeToday),
  }));

  // Reconciliation: per-variant for variant products, single line otherwise.
  const lines: ReconciliationLine[] = [];
  if (product.hasVariants && product.variants.length > 0) {
    for (const v of product.variants) {
      const vBatches = batches.filter((b) => b.variantId === v.id);
      lines.push({
        scope: "variant",
        variantId: v.id,
        label: variantLabelOf(v.size?.name, v.color?.name, v.sku),
        ...reconcileBatchStock(Number(v.stock), vBatches),
      });
    }
  } else {
    // A variant product with no variants yet falls through to here on purpose:
    // an empty `lines` makes `lines.every(...)` vacuously true, so the banner
    // would claim the stock reconciles while checking nothing at all.
    const pBatches = batches.filter((b) => b.variantId === null);
    lines.push({
      scope: "product",
      variantId: null,
      label: product.name,
      ...reconcileBatchStock(Number(product.stock), pBatches),
    });
  }

  return {
    productId: product.id,
    productName: product.name,
    hasVariants: product.hasVariants,
    trackBatch: product.trackBatch,
    trackExpiry: product.trackExpiry,
    storeToday,
    unit: product.unit ?? "piece",
    allowDecimalQuantity: product.allowDecimalQuantity,
    variants: product.variants.map((v) => ({
      id: v.id,
      label: variantLabelOf(v.size?.name, v.color?.name, v.sku),
      sku: v.sku,
      aggregateStock: Number(v.stock),
    })),
    batches,
    reconciliation: { ok: lines.every((l) => l.reconciled), lines },
  };
}

/**
 * Store-wide reconciliation summary across all tracked products. Read-only —
 * never repairs anything. Returns only the discrepant lines plus a count.
 */
export async function getStoreBatchReconciliation(storeId: string) {
  // One set-based query instead of a per-product getProductBatchView call:
  // the store-wide summary only needs stock aggregates, so it skips the
  // timezone/expiry work that the single-product view does.
  const products = await prisma.product.findMany({
    where: { storeId, trackBatch: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      hasVariants: true,
      stock: true,
      variants: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          sku: true,
          stock: true,
          size: { select: { name: true } },
          color: { select: { name: true } },
        },
      },
      batches: { select: { variantId: true, stock: true } },
    },
  });

  const discrepancies: (ReconciliationLine & { productId: string; productName: string })[] = [];
  for (const p of products) {
    const batches = p.batches.map((b) => ({ variantId: b.variantId, stock: Number(b.stock) }));
    const lines: ReconciliationLine[] = p.hasVariants
      ? p.variants.map((v) => ({
          scope: "variant" as const,
          variantId: v.id,
          label: variantLabelOf(v.size?.name, v.color?.name, v.sku),
          ...reconcileBatchStock(
            Number(v.stock),
            batches.filter((b) => b.variantId === v.id)
          ),
        }))
      : [
          {
            scope: "product" as const,
            variantId: null,
            label: p.name,
            ...reconcileBatchStock(
              Number(p.stock),
              batches.filter((b) => b.variantId === null)
            ),
          },
        ];
    for (const line of lines) {
      if (!line.reconciled) {
        discrepancies.push({ ...line, productId: p.id, productName: p.name });
      }
    }
  }
  return { trackedProducts: products.length, discrepancies };
}
