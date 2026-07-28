"use client";

import Image from "next/image";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Archive, ArchiveRestore, Trash2, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge, type StatusBadgeVariant } from "@/components/shared/status-badge";
import { formatCurrency, formatPercent } from "@/lib/format";
import { PRODUCT_STATUS_LABELS } from "@/lib/labels";
import type { ProductListItem } from "@/lib/queries/products";

const STATUS_VARIANT: Record<string, StatusBadgeVariant> = {
  ACTIVE: "success",
  DRAFT: "neutral",
  ARCHIVED: "warning",
};

export function buildProductColumns({
  currency,
  canEdit,
  canViewCost,
  onArchiveToggle,
  onDelete,
}: {
  currency: string;
  canEdit: boolean;
  canViewCost: boolean;
  onArchiveToggle: (product: ProductListItem) => void;
  onDelete: (product: ProductListItem) => void;
}): ColumnDef<ProductListItem, unknown>[] {
  const columns: ColumnDef<ProductListItem, unknown>[] = [
    {
      id: "product",
      accessorFn: (row) => `${row.name} ${row.sku}`,
      header: "Product",
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="flex items-center gap-3 py-1">
            <div className="relative size-10 shrink-0 overflow-hidden rounded-lg border bg-muted">
              {p.image ? (
                <Image src={p.image} alt={p.name} fill className="object-cover" sizes="40px" />
              ) : (
                <div className="flex size-full items-center justify-center text-muted-foreground">
                  <ImageOff className="size-4" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium">{p.name}</p>
              <p className="truncate text-xs text-muted-foreground">{p.sku}</p>
            </div>
          </div>
        );
      },
    },
    {
      id: "category",
      accessorFn: (row) => row.categoryName ?? "",
      header: "Category",
      cell: ({ row }) =>
        row.original.categoryName ? (
          <StatusBadge variant="neutral">{row.original.categoryName}</StatusBadge>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      id: "variant",
      header: "Variant",
      cell: ({ row }) => {
        const p = row.original;
        const parts = [p.type, p.size, p.color].filter(Boolean);
        return <span className="text-sm text-muted-foreground">{parts.join(" · ") || "—"}</span>;
      },
    },
    {
      id: "sellingPrice",
      accessorFn: (row) => row.sellingPrice,
      header: "Price",
      cell: ({ row }) => (
        <span className="tabular-nums">{formatCurrency(row.original.sellingPrice, currency)}</span>
      ),
    },
    {
      id: "stock",
      accessorFn: (row) => row.stock,
      header: "Stock",
      cell: ({ row }) => {
        const p = row.original;
        const variant: StatusBadgeVariant =
          p.stock === 0 ? "destructive" : p.stock <= p.minimumStock ? "warning" : "success";
        return (
          <StatusBadge variant={variant}>
            {p.stock} unit{p.stock === 1 ? "" : "s"}
          </StatusBadge>
        );
      },
    },
    {
      id: "status",
      accessorFn: (row) => row.status,
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANT[row.original.status]}>
          {PRODUCT_STATUS_LABELS[row.original.status]}
        </StatusBadge>
      ),
    },
  ];

  if (canViewCost) {
    columns.splice(4, 0, {
      id: "profitMargin",
      accessorFn: (row) => row.profitMargin,
      header: "Margin",
      cell: ({ row }) => (
        <StatusBadge variant={row.original.profitMargin >= 30 ? "success" : "neutral"}>
          {formatPercent(row.original.profitMargin)}
        </StatusBadge>
      ),
    });
  }

  if (canEdit) {
    columns.push({
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const p = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => e.stopPropagation()}
                aria-label="Product actions"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem asChild>
                <Link href={`/products/${p.id}/edit`}>
                  <Pencil />
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onArchiveToggle(p)}>
                {p.status === "ARCHIVED" ? <ArchiveRestore /> : <Archive />}
                {p.status === "ARCHIVED" ? "Activate" : "Archive"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(p)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    });
  }

  return columns;
}
