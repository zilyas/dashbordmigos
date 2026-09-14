import { z } from "zod";

/** Defining a store's custom variant axis. `key` is derived from `label`. */
export const variantAxisSchema = z.object({
  label: z.string().min(1, "Label is required").max(40),
  position: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export type VariantAxisInput = z.infer<typeof variantAxisSchema>;
