import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { ManagersTable } from "@/components/managers/managers-table";
import { getManagers } from "@/lib/queries/users";
import { getStoresForPicker } from "@/lib/queries/stores";
import { getSessionContext } from "@/lib/store-context";
import { getTranslations } from "next-intl/server";
import { toAppLocale } from "@/i18n/messages";

export const metadata: Metadata = { title: "Managers" };

export default async function ManagersPage() {
  const context = await getSessionContext();
  const t = await getTranslations({ locale: toAppLocale(context?.locale), namespace: "people.managers.page" });
  const [managers, stores] = await Promise.all([getManagers(), getStoresForPicker()]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description", { count: managers.length })}
      />
      <ManagersTable managers={managers} stores={stores} />
    </div>
  );
}
