import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { ActivityTable } from "@/components/activity/activity-table";
import { getActivityLogs } from "@/lib/queries/activity";
import { getSessionContext } from "@/lib/store-context";

export const metadata: Metadata = { title: "Activity Log" };

export default async function ActivityPage() {
  const context = await getSessionContext();
  const isSuperAdmin = context!.role === "SUPER_ADMIN";
  const logs = await getActivityLogs(isSuperAdmin ? null : context!.storeId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Activity log"
        description={
          isSuperAdmin
            ? "A record of key actions across every store."
            : "A record of key actions across your store."
        }
      />
      <ActivityTable logs={logs} showStore={isSuperAdmin} />
    </div>
  );
}
