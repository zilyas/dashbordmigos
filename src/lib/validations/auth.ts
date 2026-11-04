import { z } from "zod";

import type { ValidationT } from "@/lib/validations/types";

export function buildLoginSchema(t: ValidationT) {
  return z.object({
    email: z.email(t("email.invalid")),
    password: z.string().min(1, t("password.required")),
    code: z.string().optional(),
    rememberMe: z.boolean().optional(),
  });
}

export type LoginInput = z.infer<ReturnType<typeof buildLoginSchema>>;
