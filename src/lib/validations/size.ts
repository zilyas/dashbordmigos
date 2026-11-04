import { z } from "zod";

import type { ValidationT } from "@/lib/validations/types";

export function buildSizeSchema(t: ValidationT) {
  return z.object({
    name: z.string().min(1, t("name.required")).max(30),
    position: z.number().int().min(0).max(9999).optional(),
  });
}

export type SizeInput = z.infer<ReturnType<typeof buildSizeSchema>>;
