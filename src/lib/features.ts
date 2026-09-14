import { prisma } from "@/lib/prisma";

/**
 * Per-store feature flags for optional multi-vertical extensions. Stored as a
 * JSON column on Store (`store.features`). All flags default to false, so a
 * store that never touches them behaves exactly like before.
 *
 * Core POS/catalog logic must stay flag-agnostic; only the optional extensions
 * (units, custom variant axes, category attributes, expiry/batch) read these.
 */
export type StoreFeatures = {
  units_enabled: boolean;
  custom_variant_axes_enabled: boolean;
  category_attributes_enabled: boolean;
  expiry_batch_enabled: boolean;
};

export const FEATURE_KEYS = [
  "units_enabled",
  "custom_variant_axes_enabled",
  "category_attributes_enabled",
  "expiry_batch_enabled",
] as const;

export const DEFAULT_FEATURES: StoreFeatures = {
  units_enabled: false,
  custom_variant_axes_enabled: false,
  category_attributes_enabled: false,
  expiry_batch_enabled: false,
};

/** Pure: coerce an unknown JSON value into a fully-defaulted StoreFeatures. */
export function parseFeatures(value: unknown): StoreFeatures {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return {
      units_enabled: v.units_enabled === true,
      custom_variant_axes_enabled: v.custom_variant_axes_enabled === true,
      category_attributes_enabled: v.category_attributes_enabled === true,
      expiry_batch_enabled: v.expiry_batch_enabled === true,
    };
  }
  return { ...DEFAULT_FEATURES };
}

/**
 * Loads a store's features. Call once per request and read the fields you need
 * rather than calling the individual helpers repeatedly (each hits the DB).
 * A null/undefined storeId (e.g. Super Admin with no store) yields all-false.
 */
export async function getStoreFeatures(
  storeId: string | null | undefined
): Promise<StoreFeatures> {
  if (!storeId) return { ...DEFAULT_FEATURES };
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { features: true },
  });
  return parseFeatures(store?.features);
}

export async function isUnitsEnabled(storeId: string | null | undefined): Promise<boolean> {
  return (await getStoreFeatures(storeId)).units_enabled;
}
export async function isCustomVariantAxesEnabled(storeId: string | null | undefined): Promise<boolean> {
  return (await getStoreFeatures(storeId)).custom_variant_axes_enabled;
}
export async function isCategoryAttributesEnabled(storeId: string | null | undefined): Promise<boolean> {
  return (await getStoreFeatures(storeId)).category_attributes_enabled;
}
export async function isExpiryBatchEnabled(storeId: string | null | undefined): Promise<boolean> {
  return (await getStoreFeatures(storeId)).expiry_batch_enabled;
}
