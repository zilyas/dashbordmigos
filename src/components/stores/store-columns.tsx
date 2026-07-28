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
import { STORE_STATUS_LABELS } from "@/lib/labels";
import type { StoreListItem } from "@/lib/queries/stores";

const STATUS_VARIANT: Record<string, StatusBadgeVariant> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
};

export function buildStoreColumns({
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  onEdit: (store: StoreListItem) => void;
  onToggleStatus: (store: StoreListItem) => void;
  onDelete: (store: StoreListItem) => void;
}): ColumnDef<StoreListItem, unknown>[] {
  return [
    {
      id: "store",
      accessorFn: (row) => `${row.name} ${row.code}`,
      header: "Store",
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
      header: "Location",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {[row.original.city, row.original.country].filter(Boolean).join(", ") || "—"}
        </span>
      ),
    },
    {
      id: "manager",
      accessorFn: (row) => row.managerName ?? "",
      header: "Manager",
      cell: ({ row }) =>
        row.original.managerName ? (
          <div>
            <p className="text-sm">{row.original.managerName}</p>
            <p className="text-xs text-muted-foreground">{row.original.managerEmail}</p>
          </div>
        ) : (
          <StatusBadge variant="warning">Unassigned</StatusBadge>
        ),
    },
    {
      id: "products",
      accessorFn: (row) => row.productCount,
      header: "Products",
      cell: ({ row }) => <span className="tabular-nums">{row.original.productCount}</span>,
    },
    {
      id: "employees",
      accessorFn: (row) => row.employeeCount,
      header: "Employees",
      cell: ({ row }) => <span className="tabular-nums">{row.original.employeeCount}</span>,
    },
    {
      id: "status",
      accessorFn: (row) => row.status,
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANT[row.original.status]}>
          {STORE_STATUS_LABELS[row.original.status]}
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
                aria-label="Store actions"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem asChild>
                <Link href={`/stores/${store.id}`}>
                  <Eye />
                  View details
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(store)}>
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onToggleStatus(store)}>
                {store.status === "ACTIVE" ? <Ban /> : <CheckCircle2 />}
                {store.status === "ACTIVE" ? "Deactivate" : "Activate"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(store)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
