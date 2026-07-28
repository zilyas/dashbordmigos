import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { PageHeader } from "@/components/shared/page-header";
import { POSTerminal } from "@/components/sales/pos-terminal";
import { getPOSProducts } from "@/lib/queries/sales";
import { getStoreSettings } from "@/lib/queries/settings";

export const metadata: Metadata = { title: "New Sale" };

export default async function NewSalePage() {
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);

  const [session, products, settings] = await Promise.all([
    auth(),
    getPOSProducts(storeId),
    getStoreSettings(storeId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New sale" description="Search or scan products to build the cart." />
      <POSTerminal
        products={products}
        taxRate={settings.taxRate}
        currency={settings.currency}
        storeName={settings.storeName}
        sellerName={session!.user.name ?? "Seller"}
      />
    </div>
  );
}
