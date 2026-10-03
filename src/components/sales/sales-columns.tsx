"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { SaleActions } from "@/components/sales/sale-actions";
import { SaleReceiptButton } from "@/components/sales/sale-receipt-button";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import type { SaleListItem } from "@/lib/queries/sales";

/** Shown for sales with no apiClient — rung up by a human on the POS terminal. */
const IN_STORE_SOURCE = "In-store";

export function buildSalesColumns({
  currency,
  showSeller,
  showProfit,
  canManage,
}: {
  currency: string;
  showSeller: boolean;
  showProfit: boolean;
  /** Managers can refund/edit/delete; Sellers only ever read their own sales. */
  canManage: boolean;
}): ColumnDef<SaleListItem, unknown>[] {
  const columns: ColumnDef<SaleListItem, unknown>[] = [
    {
      id: "invoiceNumber",
      accessorFn: (row) => row.invoiceNumber,
      header: "Invoice",
      cell: ({ row }) => {
        const sale = row.original;
        return (
          <div className="flex items-center gap-2">
            <span className="font-medium">{sale.invoiceNumber}</span>
            {sale.status === "REFUNDED" && <StatusBadge variant="destructive">Returned</StatusBadge>}
            {sale.status === "PARTIALLY_REFUNDED" && (
              <StatusBadge variant="warning">Part-returned</StatusBadge>
            )}
          </div>
        );
      },
    },
    {
      id: "createdAt",
      accessorFn: (row) => row.createdAt,
      header: "Date",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>
      ),
    },
    {
      id: "customer",
      accessorFn: (row) => row.customerName ?? "Walk-in",
      header: "Customer",
    },
  ];

  if (showSeller) {
    columns.push({
      id: "seller",
      accessorFn: (row) => row.sellerName,
      header: "Seller",
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
      accessorFn: (row) => row.apiClientName ?? IN_STORE_SOURCE,
      header: "Source",
      cell: ({ row }) => {
        const apiClientName = row.original.apiClientName;
        return apiClientName ? (
          <StatusBadge variant="info">{apiClientName}</StatusBadge>
        ) : (
          <span className="text-sm text-muted-foreground">{IN_STORE_SOURCE}</span>
        );
      },
    });
  }

  columns.push(
    {
      id: "items",
      accessorFn: (row) => row.itemCount,
      header: "Items",
      cell: ({ row }) => <span className="tabular-nums">{row.original.itemCount}</span>,
    },
    {
      id: "paymentMethod",
      accessorFn: (row) => row.paymentMethod,
      header: "Payment",
      cell: ({ row }) => (
        <StatusBadge variant="neutral">{PAYMENT_METHOD_LABELS[row.original.paymentMethod]}</StatusBadge>
      ),
    },
    {
      id: "total",
      accessorFn: (row) => row.total,
      header: "Total",
      cell: ({ row }) => {
        const sale = row.original;
        return (
          <div className="flex flex-col">
            <span className="font-medium tabular-nums">{formatCurrency(sale.total, currency)}</span>
            {sale.refundedTotal > 0 && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatCurrency(sale.refundedTotal, currency)} refunded
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
      header: "Profit",
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
