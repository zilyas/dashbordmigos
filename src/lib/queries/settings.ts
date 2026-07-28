import { prisma } from "@/lib/prisma";

export type StoreSettings = {
  id: string;
  storeName: string;
  currency: string;
  taxRate: number;
  allowSellerViewCost: boolean;
  address: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  logo: string | null;
};

export async function getStoreSettings(storeId: string): Promise<StoreSettings> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });

  return {
    id: store.id,
    storeName: store.name,
    currency: store.currency,
    taxRate: Number(store.taxRate),
    allowSellerViewCost: store.allowSellerViewCost,
    address: store.address,
    city: store.city,
    country: store.country,
    phone: store.phone,
    email: store.email,
    logo: store.logo,
  };
}
