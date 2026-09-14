import { z } from "zod";

export const saleItemSchema = z.object({
  productId: z.string(),
  /** Set for variant-enabled products; the chosen ProductVariant. */
  variantId: z.string().optional().or(z.literal("")),
  // Positive; decimals allowed only for decimal-enabled products (checked
  // server-side against the product's policy). Piece products stay integer.
  quantity: z.number().positive(),
});

export const saleSchema = z.object({
  customerName: z.string().max(120).optional().or(z.literal("")),
  customerPhone: z.string().max(30).optional().or(z.literal("")),
  discountPercent: z.number().min(0).max(100),
  paymentMethod: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]),
  items: z.array(saleItemSchema).min(1, "Add at least one product"),
  /**
   * Manager-only: knowingly allocate from EXPIRED batches when non-expired stock
   * is insufficient (Phase 5). Ignored unless the acting session is a MANAGER —
   * enforced server-side from the session role, never from this client boolean.
   */
  allowExpiredOverride: z.boolean().optional(),
});

export type SaleInput = z.infer<typeof saleSchema>;

/** One line of a return: how many units of a given sale item come back. */
export const saleReturnItemSchema = z.object({
  saleItemId: z.string().min(1),
  quantity: z.number().positive(),
  /**
   * Manager-only (Phase 5): restore this line's stock into a different ACTIVE
   * batch instead of the original allocation(s) — e.g. when the original batch was
   * archived. The original allocation's returnedQuantity still advances (so
   * accounting stays correct); only the physical destination changes. Enforced as
   * MANAGER server-side; ignored for Sellers.
   */
  overrideBatchId: z.string().optional().or(z.literal("")),
});

export const saleReturnSchema = z.object({
  items: z.array(saleReturnItemSchema).min(1, "Select at least one item to return"),
  reason: z.string().max(300).optional().or(z.literal("")),
});

export type SaleReturnInput = z.infer<typeof saleReturnSchema>;

/** Only the non-financial details of a sale are editable in place. */
export const saleDetailsSchema = z.object({
  customerName: z.string().max(120).optional().or(z.literal("")),
  customerPhone: z.string().max(30).optional().or(z.literal("")),
  paymentMethod: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]),
});

export type SaleDetailsInput = z.infer<typeof saleDetailsSchema>;
