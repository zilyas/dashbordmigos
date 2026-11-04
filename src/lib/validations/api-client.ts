import { z } from "zod";
import { API_SCOPES } from "@/lib/api/scopes";

import type { ValidationT } from "@/lib/validations/types";

/**
 * A storefront credential, as created from the dashboard. Deliberately smaller
 * than what `scripts/api-key.ts` can do: the CLI may mint a never-expiring key
 * for an operator, the UI always sets an expiry so a forgotten key dies.
 */
export function buildApiClientSchema(t: ValidationT) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(2, t("name.min2"))
      .max(60, t("name.max60")),
    /** At least one, and only from the published vocabulary. */
    scopes: z
      .array(z.enum(API_SCOPES))
      .min(1, t("permissions.atLeastOne"))
      .refine((s) => new Set(s).size === s.length, t("permissions.duplicate")),
    /** Hard ceiling of one year: a key that outlives the integration is a liability. */
    expiresInDays: z.number().int().min(1).max(365),
  });
}

export type ApiClientInput = z.infer<ReturnType<typeof buildApiClientSchema>>;
