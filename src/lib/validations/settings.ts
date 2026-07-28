import { z } from "zod";

export const storeSettingsSchema = z.object({
  storeName: z.string().min(2, "Name must be at least 2 characters").max(100),
  currency: z.string().length(3, "Use a 3-letter currency code, e.g. USD"),
  taxRate: z.number().min(0).max(100),
  allowSellerViewCost: z.boolean(),
  address: z.string().max(200).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  country: z.string().max(100).optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  email: z.email("Enter a valid email address").optional().or(z.literal("")),
  logo: z.string().optional().or(z.literal("")),
});

export type StoreSettingsInput = z.infer<typeof storeSettingsSchema>;
