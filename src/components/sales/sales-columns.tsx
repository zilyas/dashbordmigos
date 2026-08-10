"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { SaleActions } from "@/components/sales/sale-actions";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import type { SaleListItem } from "@/lib/queries/sales";

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

  if (canManage) {
    columns.push({
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => <SaleActions sale={row.original} currency={currency} />,
    });
  }

  return columns;
}
