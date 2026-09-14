import { z } from "zod";
import { isValidIanaTimezone } from "@/lib/timezone";

/** Optional multi-vertical extension toggles (see src/lib/features.ts). */
export const storeFeaturesSchema = z.object({
  units_enabled: z.boolean(),
  custom_variant_axes_enabled: z.boolean(),
  category_attributes_enabled: z.boolean(),
  expiry_batch_enabled: z.boolean(),
});

export type StoreFeaturesInput = z.infer<typeof storeFeaturesSchema>;

export const storeSettingsSchema = z.object({
  storeName: z.string().min(2, "Name must be at least 2 characters").max(100),
  currency: z.string().length(3, "Use a 3-letter currency code, e.g. USD"),
  timezone: z.string().refine(isValidIanaTimezone, "Choose a valid IANA timezone"),
  taxRate: z.number().min(0).max(100),
  allowSellerViewCost: z.boolean(),
  address: z.string().max(200).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  country: z.string().max(100).optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  email: z.email("Enter a valid email address").optional().or(z.literal("")),
  logo: z.string().optional().or(z.literal("")),
  features: storeFeaturesSchema,
});

export type StoreSettingsInput = z.infer<typeof storeSettingsSchema>;
