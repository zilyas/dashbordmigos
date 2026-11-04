import { z } from "zod";

import type { ValidationT } from "@/lib/validations/types";

/** Defining a store's custom variant axis. `key` is derived from `label`. */
export function buildVariantAxisSchema(t: ValidationT) {
  return z.object({
    label: z.string().min(1, t("label.required")).max(40),
    position: z.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
  });
}

export type VariantAxisInput = z.infer<ReturnType<typeof buildVariantAxisSchema>>;
