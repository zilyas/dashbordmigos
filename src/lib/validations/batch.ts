import { z } from "zod";

/**
 * Zod schemas for batch/lot management (Phase 4 operational). These validate
 * shape only; store/product/variant ownership, the decimal-quantity policy
 * (needs units_enabled + allowDecimalQuantity), and batch status are enforced
 * server-side in `src/actions/batches.ts` against the session-derived storeId.
 */

import type { ValidationT } from "@/lib/validations/types";

function batchCode(t: ValidationT) {
  return z
    .string()
    .trim()
    .min(1, t("batchCode.required"))
    .max(60, t("batchCode.tooLong"));
}

/** Date-only key YYYY-MM-DD (no time, no timezone). */
function dateKey(t: ValidationT) {
  return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t("date.format"));
}

/** Enable batch tracking for one product (opening-stock backfill happens server-side). */
export const enableBatchTrackingSchema = z.object({
  productId: z.string().min(1),
});
export type EnableBatchTrackingInput = z.infer<typeof enableBatchTrackingSchema>;

/** Receive stock into a new or existing batch. */
export function buildReceiveBatchStockSchema(t: ValidationT) {
  return z.object({
    productId: z.string().min(1),
    /** Null/empty = product-level batch; otherwise must belong to productId. */
    variantId: z.string().optional().or(z.literal("")),
    batchCode: batchCode(t),
    /** Units received — must be positive; decimal policy checked server-side. */
    quantity: z.number().finite().positive(t("quantity.positive")),
    /** Optional per-lot cost (reporting metadata only; never touches sale money math). */
    costPrice: z.number().finite().min(0).optional(),
    /** Required only for trackExpiry products (enforced server-side). Date-only. */
    expiryDate: dateKey(t).optional().or(z.literal("")),
  });
}
export type ReceiveBatchStockInput = z.infer<ReturnType<typeof buildReceiveBatchStockSchema>>;

/** Enable expiry tracking on a batch-tracked product, assigning a date per batch. */
export function buildEnableExpiryTrackingSchema(t: ValidationT) {
  return z.object({
    productId: z.string().min(1),
    assignments: z
      .array(z.object({ batchId: z.string().min(1), expiryDate: dateKey(t) }))
      .max(500),
  });
}
export type EnableExpiryTrackingInput = z.infer<ReturnType<typeof buildEnableExpiryTrackingSchema>>;

/** Correct a single batch's expiry date. */
export function buildUpdateBatchExpirySchema(t: ValidationT) {
  return z.object({
    batchId: z.string().min(1),
    expiryDate: dateKey(t),
  });
}
export type UpdateBatchExpiryInput = z.infer<ReturnType<typeof buildUpdateBatchExpirySchema>>;

/** Archive (terminally retire) a batch. Stock is NOT changed by archiving. */
export function buildArchiveBatchSchema(t: ValidationT) {
  return z.object({
    batchId: z.string().min(1),
    reason: z.string().trim().min(1, t("reason.required")).max(200),
  });
}
export type ArchiveBatchInput = z.infer<ReturnType<typeof buildArchiveBatchSchema>>;

/** Set a batch's counted stock to an absolute value (not a blind delta). */
export function buildAdjustBatchStockSchema(t: ValidationT) {
  return z.object({
    batchId: z.string().min(1),
    /** New counted quantity — cannot be negative; decimal policy checked server-side. */
    newStock: z.number().finite().min(0, t("stock.negative")),
    reason: z.string().trim().min(1, t("reason.required")).max(200),
  });
}
export type AdjustBatchStockInput = z.infer<ReturnType<typeof buildAdjustBatchStockSchema>>;
