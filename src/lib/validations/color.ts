import { z } from "zod";

import type { ValidationT } from "@/lib/validations/types";

export function buildColorSchema(t: ValidationT) {
  return z.object({
    name: z.string().min(1, t("name.required")).max(30),
    hex: z
      .string()
      .regex(/^#([0-9a-fA-F]{6})$/, t("hexColor.format"))
      .optional()
      .or(z.literal("")),
    position: z.number().int().min(0).max(9999).optional(),
  });
}

export type ColorInput = z.infer<ReturnType<typeof buildColorSchema>>;
