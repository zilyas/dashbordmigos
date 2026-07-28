import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { StoresTable } from "@/components/stores/stores-table";
import { getStores } from "@/lib/queries/stores";

export const metadata: Metadata = { title: "Stores" };

export default async function StoresPage() {
  const stores = await getStores();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stores"
        description={`${stores.length} store${stores.length === 1 ? "" : "s"} on the platform`}
      />
      <StoresTable stores={stores} />
    </div>
  );
}
