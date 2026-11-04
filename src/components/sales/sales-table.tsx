"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Receipt } from "lucide-react";
import { DataTable } from "@/components/shared/data-table";
import { buildSalesColumns } from "@/components/sales/sales-columns";
import type { SaleListItem } from "@/lib/queries/sales";

export function SalesTable({
  sales,
  currency,
  showSeller,
  showProfit,
  canManage = false,
}: {
  sales: SaleListItem[];
  currency: string;
  showSeller: boolean;
  showProfit: boolean;
  canManage?: boolean;
}) {
  const tLabels = useTranslations("labels");
  const t = useTranslations("sales.list.table");
  const tColumns = useTranslations("sales.list.columns");
  const columns = useMemo(
    () => buildSalesColumns({ currency, showSeller, showProfit, canManage, tLabels, t: tColumns }),
    [currency, showSeller, showProfit, canManage, tLabels, tColumns]
  );

  return (
    <DataTable
      columns={columns}
      data={sales}
      searchPlaceholder={
        showSeller ? t("searchPlaceholderWithSeller") : t("searchPlaceholder")
      }
      emptyIcon={<Receipt />}
      emptyTitle={t("emptyTitle")}
      emptyDescription={t("emptyDescription")}
      pageSize={15}
    />
  );
}
