import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { ManagersTable } from "@/components/managers/managers-table";
import { getManagers } from "@/lib/queries/users";
import { getStoresForPicker } from "@/lib/queries/stores";

export const metadata: Metadata = { title: "Managers" };

export default async function ManagersPage() {
  const [managers, stores] = await Promise.all([getManagers(), getStoresForPicker()]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Managers"
        description={`${managers.length} manager${managers.length === 1 ? "" : "s"} across the platform`}
      />
      <ManagersTable managers={managers} stores={stores} />
    </div>
  );
}
