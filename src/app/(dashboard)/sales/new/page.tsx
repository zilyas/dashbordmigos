import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { PageHeader } from "@/components/shared/page-header";
import { POSTerminal } from "@/components/sales/pos-terminal";
import { getPOSProducts } from "@/lib/queries/sales";
import { getStoreSettings } from "@/lib/queries/settings";
import { getTranslations } from "next-intl/server";
import { toAppLocale } from "@/i18n/messages";

export const metadata: Metadata = { title: "New Sale" };

export default async function NewSalePage() {
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);
  const t = await getTranslations({ locale: toAppLocale(context!.locale), namespace: "sales.list.newPage" });

  const [session, products, settings] = await Promise.all([
    auth(),
    getPOSProducts(storeId),
    getStoreSettings(storeId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <POSTerminal
        products={products}
        taxRate={settings.taxRate}
        currency={settings.currency}
        storeName={settings.storeName}
        sellerName={session!.user.name ?? "Seller"}
        unitsEnabled={settings.features.units_enabled}
        isManager={context!.role === "MANAGER"}
      />
    </div>
  );
}
