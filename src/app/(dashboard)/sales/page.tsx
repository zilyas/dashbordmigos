import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { can } from "@/lib/rbac";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { SalesTable } from "@/components/sales/sales-table";
import { getSales } from "@/lib/queries/sales";
import { getStoreSettings } from "@/lib/queries/settings";

export const metadata: Metadata = { title: "Sales" };

export default async function SalesPage() {
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);
  const role = context!.role;

  const [sales, settings] = await Promise.all([
    getSales({ role, userId: context!.userId, storeId }),
    getStoreSettings(storeId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={role === "SELLER" ? "My sales" : "Sales"}
        description={`${sales.length} sale${sales.length === 1 ? "" : "s"}${role === "SELLER" ? " you've made" : " across the store"}`}
        actions={
          <Button asChild className="gap-1.5">
            <Link href="/sales/new">
              <Plus className="size-4" />
              New Sale
            </Link>
          </Button>
        }
      />
      <SalesTable
        sales={sales}
        currency={settings.currency}
        showSeller={role !== "SELLER"}
        showProfit={can(role, "sale.viewProfit")}
      />
    </div>
  );
}
