import { z } from "zod";
import { API_SCOPES } from "@/lib/api/scopes";

/**
 * A storefront credential, as created from the dashboard. Deliberately smaller
 * than what `scripts/api-key.ts` can do: the CLI may mint a never-expiring key
 * for an operator, the UI always sets an expiry so a forgotten key dies.
 */
export const apiClientSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(60, "Name must be 60 characters or fewer"),
  /** At least one, and only from the published vocabulary. */
  scopes: z
    .array(z.enum(API_SCOPES))
    .min(1, "Choose at least one permission")
    .refine((s) => new Set(s).size === s.length, "Duplicate permission"),
  /** Hard ceiling of one year: a key that outlives the integration is a liability. */
  expiresInDays: z.number().int().min(1).max(365),
});

export type ApiClientInput = z.infer<typeof apiClientSchema>;
