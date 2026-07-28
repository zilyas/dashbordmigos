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
