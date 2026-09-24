import type { Prisma } from "@/generated/prisma/client";

/**
 * Advances the parent `Product.updatedAt` after a variant-only stock write.
 *
 * Delta-sync (`GET /api/v1/stock?updatedSince=`) filters on `Product.updatedAt`
 * only, so a write that touches nothing but `ProductVariant.stock` is invisible
 * to every external storefront polling it. Call this in the SAME transaction as
 * the stock write, so a rolled-back sale cannot leave a phantom bump behind.
 */
export async function touchProductForVariant(
  tx: Prisma.TransactionClient,
  variantId: string
): Promise<void> {
  await tx.product.updateMany({
    where: { variants: { some: { id: variantId } } },
    data: { updatedAt: new Date() },
  });
}

/**
 * Atomic, oversell-safe stock decrement. The `stock: { gte: quantity }` guard
 * lives inside the same UPDATE, so two concurrent sales can never both pass a
 * separate check-then-write and drive stock negative — Postgres row-locks the
 * update and the loser gets `count === 0`.
 *
 * Returns true when the units were deducted, false when there was not enough
 * stock (caller aborts the transaction).
 */
export async function decrementProductStock(
  tx: Prisma.TransactionClient,
  productId: string,
  quantity: number
): Promise<boolean> {
  const res = await tx.product.updateMany({
    where: { id: productId, stock: { gte: quantity } },
    data: { stock: { decrement: quantity } },
  });
  return res.count > 0;
}

/** Variant-stock equivalent of {@link decrementProductStock}. */
export async function decrementVariantStock(
  tx: Prisma.TransactionClient,
  variantId: string,
  quantity: number
): Promise<boolean> {
  const res = await tx.productVariant.updateMany({
    where: { id: variantId, stock: { gte: quantity } },
    data: { stock: { decrement: quantity } },
  });
  if (res.count === 0) return false;
  await touchProductForVariant(tx, variantId);
  return true;
}

/** Restores units to a product (returns, sale deletion). Always succeeds. */
export async function incrementProductStock(
  tx: Prisma.TransactionClient,
  productId: string,
  quantity: number
): Promise<void> {
  await tx.product.update({
    where: { id: productId },
    data: { stock: { increment: quantity } },
  });
}

/** Restores units to a variant. */
export async function incrementVariantStock(
  tx: Prisma.TransactionClient,
  variantId: string,
  quantity: number
): Promise<void> {
  await tx.productVariant.update({
    where: { id: variantId },
    data: { stock: { increment: quantity } },
  });
  await touchProductForVariant(tx, variantId);
}

/**
 * Atomic, oversell-safe batch decrement (Phase 4). Same guard pattern as
 * {@link decrementProductStock}: the `stock: { gte: quantity }` and
 * `status: "ACTIVE"` conditions live inside the UPDATE, so two concurrent sales
 * can never both pass and drive a batch negative — the loser gets `count === 0`
 * and the caller aborts the whole transaction. Returns true when deducted.
 */
export async function decrementBatchStock(
  tx: Prisma.TransactionClient,
  batchId: string,
  quantity: number
): Promise<boolean> {
  const res = await tx.productBatch.updateMany({
    where: { id: batchId, status: "ACTIVE", stock: { gte: quantity } },
    data: { stock: { decrement: quantity } },
  });
  return res.count > 0;
}

/**
 * Atomic decrement of an EXPIRED-BY-DATE batch — only reachable via a Manager
 * expired-sale override (Phase 5). The batch may still be `ACTIVE` in status if a
 * sweep hasn't run yet, so the guard admits `ACTIVE`/`EXPIRED` (never ARCHIVED or
 * DEPLETED). The caller only builds these allocations from date-expired batches.
 */
export async function decrementExpiredBatchStock(
  tx: Prisma.TransactionClient,
  batchId: string,
  quantity: number
): Promise<boolean> {
  const res = await tx.productBatch.updateMany({
    where: { id: batchId, status: { in: ["ACTIVE", "EXPIRED"] }, stock: { gte: quantity } },
    data: { stock: { decrement: quantity } },
  });
  return res.count > 0;
}

/** Restores units to a specific batch (returns, sale deletion). Always succeeds. */
export async function incrementBatchStock(
  tx: Prisma.TransactionClient,
  batchId: string,
  quantity: number
): Promise<void> {
  await tx.productBatch.update({
    where: { id: batchId },
    data: { stock: { increment: quantity } },
  });
}
