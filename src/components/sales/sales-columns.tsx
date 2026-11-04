"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { SaleActions } from "@/components/sales/sale-actions";
import { SaleReceiptButton } from "@/components/sales/sale-receipt-button";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { paymentMethodLabel } from "@/lib/labels";
import type { SaleListItem } from "@/lib/queries/sales";

export function buildSalesColumns({
  currency,
  showSeller,
  showProfit,
  canManage,
  tLabels,
  t,
}: {
  currency: string;
  showSeller: boolean;
  showProfit: boolean;
  /** Managers can refund/edit/delete; Sellers only ever read their own sales. */
  canManage: boolean;
  /** Resolved via useTranslations("labels") in the caller. */
  tLabels: (key: string) => string;
  /** Resolved via useTranslations("sales.list.columns") in the caller. */
  t: (key: string, values?: Record<string, string | number>) => string;
}): ColumnDef<SaleListItem, unknown>[] {
  const inStoreSource = t("inStoreSource");
  const columns: ColumnDef<SaleListItem, unknown>[] = [
    {
      id: "invoiceNumber",
      accessorFn: (row) => row.invoiceNumber,
      header: t("invoice"),
      cell: ({ row }) => {
        const sale = row.original;
        return (
          <div className="flex items-center gap-2">
            <span className="font-medium">{sale.invoiceNumber}</span>
            {sale.status === "REFUNDED" && <StatusBadge variant="destructive">{t("returned")}</StatusBadge>}
            {sale.status === "PARTIALLY_REFUNDED" && (
              <StatusBadge variant="warning">{t("partReturned")}</StatusBadge>
            )}
          </div>
        );
      },
    },
    {
      id: "createdAt",
      accessorFn: (row) => row.createdAt,
      header: t("date"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>
      ),
    },
    {
      id: "customer",
      accessorFn: (row) => row.customerName ?? t("walkIn"),
      header: t("customer"),
    },
  ];

  if (showSeller) {
    columns.push({
      id: "seller",
      accessorFn: (row) => row.sellerName,
      header: t("seller"),
    });
    // Reuses the showSeller gate deliberately: a Seller only ever sees sales
    // they rang up themselves and cannot create an API sale, so the value is
    // the constant "In-store" for every row they can see. Incident response on
    // a storefront integration is a Manager/Admin job.
    columns.push({
      id: "source",
      // An accessorFn is all it takes to make the integration name reachable
      // from the table's existing global search — typing it narrows the list to
      // that client's sales, no dedicated filter UI needed.
      accessorFn: (row) => row.apiClientName ?? inStoreSource,
      header: t("source"),
      cell: ({ row }) => {
        const apiClientName = row.original.apiClientName;
        return apiClientName ? (
          <StatusBadge variant="info">{apiClientName}</StatusBadge>
        ) : (
          <span className="text-sm text-muted-foreground">{inStoreSource}</span>
        );
      },
    });
  }

  columns.push(
    {
      id: "items",
      accessorFn: (row) => row.itemCount,
      header: t("items"),
      cell: ({ row }) => <span className="tabular-nums">{row.original.itemCount}</span>,
    },
    {
      id: "paymentMethod",
      accessorFn: (row) => row.paymentMethod,
      header: t("payment"),
      cell: ({ row }) => (
        <StatusBadge variant="neutral">{paymentMethodLabel(tLabels, row.original.paymentMethod)}</StatusBadge>
      ),
    },
    {
      id: "total",
      accessorFn: (row) => row.total,
      header: t("total"),
      cell: ({ row }) => {
        const sale = row.original;
        return (
          <div className="flex flex-col">
            <span className="font-medium tabular-nums">{formatCurrency(sale.total, currency)}</span>
            {sale.refundedTotal > 0 && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {t("refunded", { amount: formatCurrency(sale.refundedTotal, currency) })}
              </span>
            )}
          </div>
        );
      },
    }
  );

  if (showProfit) {
    columns.push({
      id: "netProfit",
      accessorFn: (row) => row.netProfit,
      header: t("profit"),
      cell: ({ row }) => (
        <span className="tabular-nums text-success">{formatCurrency(row.original.netProfit, currency)}</span>
      ),
    });
  }

  // Everyone can reprint a receipt for a sale they can see; only managers get
  // the return/edit/delete menu, which already contains its own receipt item.
  columns.push({
    id: "actions",
    header: "",
    enableSorting: false,
    cell: ({ row }) =>
      canManage ? (
        <SaleActions sale={row.original} currency={currency} />
      ) : (
        <SaleReceiptButton sale={row.original} currency={currency} />
      ),
  });

  return columns;
}
