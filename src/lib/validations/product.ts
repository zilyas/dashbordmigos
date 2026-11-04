import { z } from "zod";
import { productAttributeValuesSchema } from "@/lib/validations/category-attribute";

import type { ValidationT } from "@/lib/validations/types";

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

export function buildProductSchema(t: ValidationT) {
  return z.object({
    // Trimmed so "  " is not a valid name and "ABC " / "ABC" cannot both exist
    // under @@unique([storeId, sku]).
    name: z.string().trim().min(2, t("name.min2")).max(120),
    sku: z.string().trim().min(2, t("sku.required")).max(40),
    barcode: z.string().max(40).optional().or(z.literal("")),
    description: z.string().max(2000).optional().or(z.literal("")),
    categoryId: z.string().optional().or(z.literal("")),
    type: z.string().max(60).optional().or(z.literal("")),
    size: z.string().max(30).optional().or(z.literal("")),
    color: z.string().max(30).optional().or(z.literal("")),
    // Upper bounds match the DB columns: prices are Decimal(10,2) and stock is
    // Decimal(12,3). Without them an out-of-range number reaches Postgres as an
    // uncaught numeric overflow instead of a field error.
    fabricationPrice: z.number().min(0, t("price.min0")).max(99999999.99, t("price.tooLarge")),
    sellingPrice: z
      .number()
      .min(0.01, t("price.greaterThanZero"))
      .max(99999999.99, t("price.tooLarge")),
    // Decimals allowed only when the product opts in (units_enabled +
    // allowDecimalQuantity); integer enforcement happens server-side.
    stock: z.number().min(0, t("stock.min0")).max(999999999.999, t("stock.tooLarge")),
    minimumStock: z.number().min(0, t("stock.min0")).max(999999999.999, t("stock.tooLarge")),
    status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]),
    images: z.array(z.string()).max(6, t("images.max6")),
    /** When true the product sells through variants; base stock is ignored. */
    hasVariants: z.boolean().optional(),
    /** Unit of measure (only used when the store has units_enabled). */
    unit: z.enum(PRODUCT_UNITS).optional(),
    /** Allow decimal quantities for this product (enforced in Phase 1b). */
    allowDecimalQuantity: z.boolean().optional(),
    /** Category attribute values (Phase 2); validated against definitions server-side. */
    attributes: productAttributeValuesSchema.optional(),
    /**
     * Colors picked during creation, in the order they were picked — the first
     * is the primary color. The server turns each one into a variant, because
     * `Color` relates to `ProductVariant`, never to `Product`. Ignored on
     * update: variants are managed from the product's own variant section.
     */
    colorIds: z.array(z.string()).max(20, t("colors.max20")).optional(),
    /**
     * Sizes picked during creation. Combined with `colorIds` as a cross product
     * on the server: 3 colors x 4 sizes = 12 variants. Ignored on update.
     */
    sizeIds: z.array(z.string()).max(20, t("sizes.max20")).optional(),
  });
}

export type ProductInput = z.infer<ReturnType<typeof buildProductSchema>>;
