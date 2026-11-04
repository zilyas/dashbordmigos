import { z } from "zod";
import { storeFeaturesSchema } from "@/lib/validations/settings";

import type { ValidationT } from "@/lib/validations/types";

export function buildStoreSchema(t: ValidationT) {
  return z.object({
    name: z.string().min(2, t("name.min2")).max(100),
    code: z
      .string()
      .min(2, t("storeCode.short"))
      .max(20)
      .regex(/^[A-Za-z0-9-]+$/, t("storeCode.format")),
    currency: z.string().length(3, t("currency.format")),
    taxRate: z.number().min(0).max(100),
    address: z.string().max(200).optional().or(z.literal("")),
    city: z.string().max(100).optional().or(z.literal("")),
    country: z.string().max(100).optional().or(z.literal("")),
    phone: z.string().max(30).optional().or(z.literal("")),
    email: z.email(t("email.invalid")).optional().or(z.literal("")),
    logo: z.string().optional().or(z.literal("")),
    features: storeFeaturesSchema.optional(),
  });
}

export type StoreInput = z.infer<ReturnType<typeof buildStoreSchema>>;
