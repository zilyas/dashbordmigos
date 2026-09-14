import { z } from "zod";

/**
 * Zod schemas for batch/lot management (Phase 4 operational). These validate
 * shape only; store/product/variant ownership, the decimal-quantity policy
 * (needs units_enabled + allowDecimalQuantity), and batch status are enforced
 * server-side in `src/actions/batches.ts` against the session-derived storeId.
 */

const batchCode = z
  .string()
  .trim()
  .min(1, "Batch code is required")
  .max(60, "Batch code is too long");

/** Date-only key YYYY-MM-DD (no time, no timezone). */
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

/** Enable batch tracking for one product (opening-stock backfill happens server-side). */
export const enableBatchTrackingSchema = z.object({
  productId: z.string().min(1),
});
export type EnableBatchTrackingInput = z.infer<typeof enableBatchTrackingSchema>;

/** Receive stock into a new or existing batch. */
export const receiveBatchStockSchema = z.object({
  productId: z.string().min(1),
  /** Null/empty = product-level batch; otherwise must belong to productId. */
  variantId: z.string().optional().or(z.literal("")),
  batchCode,
  /** Units received — must be positive; decimal policy checked server-side. */
  quantity: z.number().finite().positive("Quantity must be greater than zero"),
  /** Optional per-lot cost (reporting metadata only; never touches sale money math). */
  costPrice: z.number().finite().min(0).optional(),
  /** Required only for trackExpiry products (enforced server-side). Date-only. */
  expiryDate: dateKey.optional().or(z.literal("")),
});
export type ReceiveBatchStockInput = z.infer<typeof receiveBatchStockSchema>;

/** Enable expiry tracking on a batch-tracked product, assigning a date per batch. */
export const enableExpiryTrackingSchema = z.object({
  productId: z.string().min(1),
  assignments: z.array(z.object({ batchId: z.string().min(1), expiryDate: dateKey })).max(500),
});
export type EnableExpiryTrackingInput = z.infer<typeof enableExpiryTrackingSchema>;

/** Correct a single batch's expiry date. */
export const updateBatchExpirySchema = z.object({
  batchId: z.string().min(1),
  expiryDate: dateKey,
});
export type UpdateBatchExpiryInput = z.infer<typeof updateBatchExpirySchema>;

/** Archive (terminally retire) a batch. Stock is NOT changed by archiving. */
export const archiveBatchSchema = z.object({
  batchId: z.string().min(1),
  reason: z.string().trim().min(1, "A reason is required").max(200),
});
export type ArchiveBatchInput = z.infer<typeof archiveBatchSchema>;

/** Set a batch's counted stock to an absolute value (not a blind delta). */
export const adjustBatchStockSchema = z.object({
  batchId: z.string().min(1),
  /** New counted quantity — cannot be negative; decimal policy checked server-side. */
  newStock: z.number().finite().min(0, "Stock cannot be negative"),
  reason: z.string().trim().min(1, "A reason is required").max(200),
});
export type AdjustBatchStockInput = z.infer<typeof adjustBatchStockSchema>;
