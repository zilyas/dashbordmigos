import { z } from "zod";

import type { ValidationT } from "@/lib/validations/types";

export function buildCreateSellerSchema(t: ValidationT) {
  return z.object({
    name: z.string().min(2, t("name.min2")).max(80),
    email: z.email(t("email.invalid")),
    password: z.string().min(8, t("password.atLeast8")),
    phone: z.string().max(30).optional().or(z.literal("")),
  });
}

export function buildUpdateSellerSchema(t: ValidationT) {
  return z.object({
    name: z.string().min(2, t("name.min2")).max(80),
    email: z.email(t("email.invalid")),
    phone: z.string().max(30).optional().or(z.literal("")),
  });
}

export type CreateSellerInput = z.infer<ReturnType<typeof buildCreateSellerSchema>>;
export type UpdateSellerInput = z.infer<ReturnType<typeof buildUpdateSellerSchema>>;
