import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { StoresTable } from "@/components/stores/stores-table";
import { getStores } from "@/lib/queries/stores";
import { getSessionContext } from "@/lib/store-context";
import { getTranslations } from "next-intl/server";
import { toAppLocale } from "@/i18n/messages";

export const metadata: Metadata = { title: "Stores" };

export default async function StoresPage() {
  const context = await getSessionContext();
  const t = await getTranslations({ locale: toAppLocale(context?.locale), namespace: "people.stores.page" });
  const stores = await getStores();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description", { count: stores.length })}
      />
      <StoresTable stores={stores} />
    </div>
  );
}
