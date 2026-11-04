import { z } from "zod";

import type { ValidationT } from "@/lib/validations/types";

/**
 * A single product variant. Price/cost overrides are optional — an empty value
 * means "use the parent product's price". Size/color are optional axes.
 */
export function buildVariantSchema(t: ValidationT) {
  return z.object({
    sizeId: z.string().optional().or(z.literal("")),
    colorId: z.string().optional().or(z.literal("")),
    sku: z.string().min(1, t("sku.required")).max(40),
    barcode: z.string().max(40).optional().or(z.literal("")),
    sellingPrice: z.number().min(0).optional().nullable(),
    fabricationPrice: z.number().min(0).optional().nullable(),
    // Decimals enforced server-side based on the parent product's policy.
    stock: z.number().min(0, t("stock.min0")),
    isActive: z.boolean().optional(),
    imageUrl: z.string().optional().or(z.literal("")),
    /** Custom variant axis values keyed by axis key (Phase 3). Keys validated
     * against the store's axis definitions server-side. */
    axisValues: z.record(z.string(), z.string()).optional(),
  });
}

export type VariantInput = z.infer<ReturnType<typeof buildVariantSchema>>;
