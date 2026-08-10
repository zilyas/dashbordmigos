import { z } from "zod";

export const saleItemSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().min(1),
});

export const saleSchema = z.object({
  customerName: z.string().max(120).optional().or(z.literal("")),
  customerPhone: z.string().max(30).optional().or(z.literal("")),
  discountPercent: z.number().min(0).max(100),
  paymentMethod: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]),
  items: z.array(saleItemSchema).min(1, "Add at least one product"),
});

export type SaleInput = z.infer<typeof saleSchema>;

/** One line of a return: how many units of a given sale item come back. */
export const saleReturnItemSchema = z.object({
  saleItemId: z.string().min(1),
  quantity: z.number().int().min(1),
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
