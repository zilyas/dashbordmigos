import { z } from "zod";

import type { ValidationT } from "@/lib/validations/types";

export function buildCategorySchema(t: ValidationT) {
  return z.object({
    name: z.string().min(2, t("name.min2")).max(60),
    description: z.string().max(300).optional().or(z.literal("")),
    isActive: z.boolean().optional(),
    /** Optional parent category id for a shallow tree. */
    parentId: z.string().optional().or(z.literal("")),
    /** Opts the category into clothing variant support (stored in metadata). */
    isClothing: z.boolean().optional(),
  });
}

export type CategoryInput = z.infer<ReturnType<typeof buildCategorySchema>>;
