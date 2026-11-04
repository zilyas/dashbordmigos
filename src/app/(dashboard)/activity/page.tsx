import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { ActivityTable } from "@/components/activity/activity-table";
import { getActivityLogs } from "@/lib/queries/activity";
import { getSessionContext } from "@/lib/store-context";
import { getTranslations } from "next-intl/server";
import { toAppLocale } from "@/i18n/messages";

export const metadata: Metadata = { title: "Activity Log" };

export default async function ActivityPage() {
  const context = await getSessionContext();
  const isSuperAdmin = context!.role === "SUPER_ADMIN";
  const t = await getTranslations({ locale: toAppLocale(context!.locale), namespace: "activity.page" });
  const logs = await getActivityLogs(isSuperAdmin ? null : context!.storeId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={isSuperAdmin ? t("descriptionPlatform") : t("descriptionStore")}
      />
      <ActivityTable logs={logs} showStore={isSuperAdmin} />
    </div>
  );
}
