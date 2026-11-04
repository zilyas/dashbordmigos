import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { UsersTable } from "@/components/users/users-table";
import { getSellers } from "@/lib/queries/users";
import { getStoreSettings } from "@/lib/queries/settings";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { getTranslations } from "next-intl/server";
import { toAppLocale } from "@/i18n/messages";

export const metadata: Metadata = { title: "Sellers" };

export default async function UsersPage() {
  const context = await getSessionContext();
  if (context!.role === "SUPER_ADMIN") {
    redirect("/managers");
  }
  const storeId = requireStoreId(context!);
  const t = await getTranslations({ locale: toAppLocale(context!.locale), namespace: "people.users.page" });

  const [sellers, settings] = await Promise.all([getSellers(storeId), getStoreSettings(storeId)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description", { count: sellers.length })}
      />
      <UsersTable sellers={sellers} currency={settings.currency} />
    </div>
  );
}
