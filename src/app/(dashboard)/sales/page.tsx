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
import { getTranslations } from "next-intl/server";
import { toAppLocale } from "@/i18n/messages";

export const metadata: Metadata = { title: "Sales" };

export default async function SalesPage() {
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);
  const role = context!.role;
  const t = await getTranslations({ locale: toAppLocale(context!.locale), namespace: "sales.list.page" });

  const [sales, settings] = await Promise.all([
    getSales({ role, userId: context!.userId, storeId }),
    getStoreSettings(storeId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={role === "SELLER" ? t("titleSeller") : t("titleOther")}
        description={role === "SELLER" ? t("descriptionSeller", { count: sales.length }) : t("descriptionOther", { count: sales.length })}
        actions={
          <Button asChild className="gap-1.5">
            <Link href="/sales/new">
              <Plus className="size-4" />
              {t("newSale")}
            </Link>
          </Button>
        }
      />
      <SalesTable
        sales={sales}
        currency={settings.currency}
        showSeller={role !== "SELLER"}
        showProfit={can(role, "sale.viewProfit")}
        canManage={can(role, "sale.refund")}
      />
    </div>
  );
}
