import { z } from "zod";

import type { ValidationT } from "@/lib/validations/types";

export function buildCreateManagerSchema(t: ValidationT) {
  return z.object({
    name: z.string().min(2, t("name.min2")).max(80),
    email: z.email(t("email.invalid")),
    password: z.string().min(8, t("password.atLeast8")),
    phone: z.string().max(30).optional().or(z.literal("")),
    storeId: z.string().min(1, t("store.select")),
  });
}

export function buildUpdateManagerSchema(t: ValidationT) {
  return z.object({
    name: z.string().min(2, t("name.min2")).max(80),
    email: z.email(t("email.invalid")),
    phone: z.string().max(30).optional().or(z.literal("")),
  });
}

export type CreateManagerInput = z.infer<ReturnType<typeof buildCreateManagerSchema>>;
export type UpdateManagerInput = z.infer<ReturnType<typeof buildUpdateManagerSchema>>;
