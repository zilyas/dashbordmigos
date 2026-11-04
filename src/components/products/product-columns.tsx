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
import { productStatusLabel } from "@/lib/labels";
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
  tLabels,
  t,
}: {
  currency: string;
  canEdit: boolean;
  canViewCost: boolean;
  onArchiveToggle: (product: ProductListItem) => void;
  onDelete: (product: ProductListItem) => void;
  /** Resolved via useTranslations("labels") in the caller (products-table.tsx). */
  tLabels: (key: string) => string;
  /** Resolved via useTranslations("products.columns") in the caller. */
  t: (key: string, values?: Record<string, string | number>) => string;
}): ColumnDef<ProductListItem, unknown>[] {
  const columns: ColumnDef<ProductListItem, unknown>[] = [
    {
      id: "product",
      accessorFn: (row) => `${row.name} ${row.sku}`,
      header: t("product"),
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
      header: t("category"),
      cell: ({ row }) =>
        row.original.categoryName ? (
          <StatusBadge variant="neutral">{row.original.categoryName}</StatusBadge>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      id: "variant",
      header: t("variant"),
      cell: ({ row }) => {
        const p = row.original;
        const parts = [p.type, p.size, p.color].filter(Boolean);
        return <span className="text-sm text-muted-foreground">{parts.join(" · ") || "—"}</span>;
      },
    },
    {
      id: "sellingPrice",
      accessorFn: (row) => row.sellingPrice,
      header: t("price"),
      cell: ({ row }) => (
        <span className="tabular-nums">{formatCurrency(row.original.sellingPrice, currency)}</span>
      ),
    },
    {
      id: "stock",
      accessorFn: (row) => row.stock,
      header: t("stock"),
      cell: ({ row }) => {
        const p = row.original;
        const variant: StatusBadgeVariant =
          p.stock === 0 ? "destructive" : p.stock <= p.minimumStock ? "warning" : "success";
        return (
          <div className="flex flex-col gap-0.5">
            <StatusBadge variant={variant}>
              {t("stockUnits", { count: p.stock })}
            </StatusBadge>
            {/* For a variant product this figure is the sum of its live
                variants, not an editable field on the product — the form hides
                the stock input once variants are on. Saying so stops an owner
                hunting for a product-level box that does not exist. */}
            {p.hasVariants && (
              <span className="text-[11px] text-muted-foreground">
                {t("acrossVariants", { count: p.variantCount })}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "status",
      accessorFn: (row) => row.status,
      header: t("status"),
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANT[row.original.status]}>
          {productStatusLabel(tLabels, row.original.status)}
        </StatusBadge>
      ),
    },
  ];

  if (canViewCost) {
    columns.splice(4, 0, {
      id: "profitMargin",
      accessorFn: (row) => row.profitMargin,
      header: t("margin"),
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
                aria-label={t("actionsLabel")}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem asChild>
                <Link href={`/products/${p.id}/edit`}>
                  <Pencil />
                  {t("edit")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onArchiveToggle(p)}>
                {p.status === "ARCHIVED" ? <ArchiveRestore /> : <Archive />}
                {p.status === "ARCHIVED" ? t("activate") : t("archive")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(p)}>
                <Trash2 />
                {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    });
  }

  return columns;
}
