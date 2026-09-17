import { z } from "zod";

/**
 * Request body for `POST /api/v1/orders`.
 *
 * Deliberately narrower than `saleSchema` in `./sale.ts`. There is NO price,
 * no `discountPercent`, and no `allowExpiredOverride` field — a storefront key
 * must not be able to mint free goods or bypass expiry rules, so the fields
 * simply do not exist rather than being validated and then ignored. Money is
 * always recomputed server-side from the catalog row plus the store tax rate.
 */
export const apiOrderItemSchema = z.object({
  productId: z.string().min(1),
  /** Required when the product has variants; rejected when it does not. */
  variantId: z.string().min(1).optional(),
  quantity: z.number().positive(),
});

export const apiOrderSchema = z.object({
  /**
   * Caller-generated de-duplication token, unique per store. Required: without
   * it a storefront's retry-on-timeout silently decrements stock twice.
   */
  idempotencyKey: z.string().min(8).max(200),
  customerName: z.string().max(120).optional(),
  customerPhone: z.string().max(30).optional(),
  items: z.array(apiOrderItemSchema).min(1).max(100),
});

export type ApiOrderInput = z.infer<typeof apiOrderSchema>;
