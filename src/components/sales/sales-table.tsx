"use client";

import { useMemo } from "react";
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
  const columns = useMemo(
    () => buildSalesColumns({ currency, showSeller, showProfit, canManage }),
    [currency, showSeller, showProfit, canManage]
  );

  return (
    <DataTable
      columns={columns}
      data={sales}
      searchPlaceholder="Search by invoice or customer..."
      emptyIcon={<Receipt />}
      emptyTitle="No sales yet"
      emptyDescription="Completed sales will show up here."
      pageSize={15}
    />
  );
}
