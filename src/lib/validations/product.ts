import { z } from "zod";

export const productSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(120),
  sku: z.string().min(2, "SKU is required").max(40),
  barcode: z.string().max(40).optional().or(z.literal("")),
  description: z.string().max(2000).optional().or(z.literal("")),
  categoryId: z.string().optional().or(z.literal("")),
  type: z.string().max(60).optional().or(z.literal("")),
  size: z.string().max(30).optional().or(z.literal("")),
  color: z.string().max(30).optional().or(z.literal("")),
  fabricationPrice: z.number().min(0, "Must be 0 or more"),
  sellingPrice: z.number().min(0.01, "Must be greater than 0"),
  stock: z.number().int().min(0, "Must be 0 or more"),
  minimumStock: z.number().int().min(0, "Must be 0 or more"),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]),
  images: z.array(z.string()).max(6, "Up to 6 images"),
});

export type ProductInput = z.infer<typeof productSchema>;
