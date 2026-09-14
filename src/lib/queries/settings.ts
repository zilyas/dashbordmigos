import { prisma } from "@/lib/prisma";
import { parseFeatures, type StoreFeatures } from "@/lib/features";

export type StoreSettings = {
  id: string;
  storeName: string;
  currency: string;
  timezone: string;
  taxRate: number;
  allowSellerViewCost: boolean;
  address: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  logo: string | null;
  features: StoreFeatures;
};

export async function getStoreSettings(storeId: string): Promise<StoreSettings> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });

  return {
    id: store.id,
    storeName: store.name,
    currency: store.currency,
    timezone: store.timezone,
    taxRate: Number(store.taxRate),
    allowSellerViewCost: store.allowSellerViewCost,
    address: store.address,
    city: store.city,
    country: store.country,
    phone: store.phone,
    email: store.email,
    logo: store.logo,
    features: parseFeatures(store.features),
  };
}
