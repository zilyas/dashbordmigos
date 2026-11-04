"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Ban, CheckCircle2, Trash2, Eye } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge, type StatusBadgeVariant } from "@/components/shared/status-badge";
import { storeStatusLabel } from "@/lib/labels";
import type { StoreListItem } from "@/lib/queries/stores";

const STATUS_VARIANT: Record<string, StatusBadgeVariant> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
};

export function buildStoreColumns({
  onEdit,
  onToggleStatus,
  onDelete,
  tLabels,
  t,
}: {
  onEdit: (store: StoreListItem) => void;
  onToggleStatus: (store: StoreListItem) => void;
  onDelete: (store: StoreListItem) => void;
  /** Resolved via useTranslations("labels") in the caller. */
  tLabels: (key: string) => string;
  /** Resolved via useTranslations("people.stores.columns") in the caller. */
  t: (key: string) => string;
}): ColumnDef<StoreListItem, unknown>[] {
  return [
    {
      id: "store",
      accessorFn: (row) => `${row.name} ${row.code}`,
      header: t("store"),
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.original.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.original.code}</p>
        </div>
      ),
    },
    {
      id: "location",
      accessorFn: (row) => [row.city, row.country].filter(Boolean).join(", "),
      header: t("location"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {[row.original.city, row.original.country].filter(Boolean).join(", ") || "—"}
        </span>
      ),
    },
    {
      id: "manager",
      accessorFn: (row) => row.managerName ?? "",
      header: t("manager"),
      cell: ({ row }) =>
        row.original.managerName ? (
          <div>
            <p className="text-sm">{row.original.managerName}</p>
            <p className="text-xs text-muted-foreground">{row.original.managerEmail}</p>
          </div>
        ) : (
          <StatusBadge variant="warning">{t("unassigned")}</StatusBadge>
        ),
    },
    {
      id: "products",
      accessorFn: (row) => row.productCount,
      header: t("products"),
      cell: ({ row }) => <span className="tabular-nums">{row.original.productCount}</span>,
    },
    {
      id: "employees",
      accessorFn: (row) => row.employeeCount,
      header: t("employees"),
      cell: ({ row }) => <span className="tabular-nums">{row.original.employeeCount}</span>,
    },
    {
      id: "status",
      accessorFn: (row) => row.status,
      header: t("status"),
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANT[row.original.status]}>
          {storeStatusLabel(tLabels, row.original.status)}
        </StatusBadge>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const store = row.original;
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
                <Link href={`/stores/${store.id}`}>
                  <Eye />
                  {t("viewDetails")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(store)}>
                <Pencil />
                {t("edit")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onToggleStatus(store)}>
                {store.status === "ACTIVE" ? <Ban /> : <CheckCircle2 />}
                {store.status === "ACTIVE" ? t("deactivate") : t("activate")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(store)}>
                <Trash2 />
                {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
