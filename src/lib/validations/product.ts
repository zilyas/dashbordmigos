import { z } from "zod";
import { productAttributeValuesSchema } from "@/lib/validations/category-attribute";

/** Supported units of measure. Extend here as new verticals need them. */
export const PRODUCT_UNITS = ["piece", "kg", "g", "L", "pack"] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const PRODUCT_UNIT_LABELS: Record<ProductUnit, string> = {
  piece: "Piece",
  kg: "Kilogram (kg)",
  g: "Gram (g)",
  L: "Liter (L)",
  pack: "Pack",
};

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
  // Decimals allowed only when the product opts in (units_enabled +
  // allowDecimalQuantity); integer enforcement happens server-side.
  stock: z.number().min(0, "Must be 0 or more"),
  minimumStock: z.number().min(0, "Must be 0 or more"),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]),
  images: z.array(z.string()).max(6, "Up to 6 images"),
  /** When true the product sells through variants; base stock is ignored. */
  hasVariants: z.boolean().optional(),
  /** Unit of measure (only used when the store has units_enabled). */
  unit: z.enum(PRODUCT_UNITS).optional(),
  /** Allow decimal quantities for this product (enforced in Phase 1b). */
  allowDecimalQuantity: z.boolean().optional(),
  /** Category attribute values (Phase 2); validated against definitions server-side. */
  attributes: productAttributeValuesSchema.optional(),
});

export type ProductInput = z.infer<typeof productSchema>;
