"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal, Pencil, KeyRound, UserCheck, UserX, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatCurrency } from "@/lib/format";
import { initials } from "@/lib/utils";
import type { SellerListItem } from "@/lib/queries/users";

export function buildSellerColumns({
  currency,
  onEdit,
  onResetPassword,
  onToggleStatus,
  onDelete,
}: {
  currency: string;
  onEdit: (seller: SellerListItem) => void;
  onResetPassword: (seller: SellerListItem) => void;
  onToggleStatus: (seller: SellerListItem) => void;
  onDelete: (seller: SellerListItem) => void;
}): ColumnDef<SellerListItem, unknown>[] {
  return [
    {
      id: "user",
      accessorFn: (row) => `${row.name} ${row.email}`,
      header: "Seller",
      cell: ({ row }) => {
        const u = row.original;
        return (
          <div className="flex items-center gap-3 py-1">
            <Avatar className="size-8">
              {u.avatar && <AvatarImage src={u.avatar} alt={u.name} />}
              <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                {initials(u.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium">{u.name}</p>
              <p className="truncate text-xs text-muted-foreground">{u.email}</p>
            </div>
          </div>
        );
      },
    },
    {
      id: "phone",
      accessorFn: (row) => row.phone ?? "",
      header: "Phone",
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.phone || "—"}</span>,
    },
    {
      id: "salesCount",
      accessorFn: (row) => row.salesCount,
      header: "Sales",
      cell: ({ row }) => <span className="tabular-nums">{row.original.salesCount}</span>,
    },
    {
      id: "salesTotal",
      accessorFn: (row) => row.salesTotal,
      header: "Revenue",
      cell: ({ row }) => (
        <span className="tabular-nums">{formatCurrency(row.original.salesTotal, currency)}</span>
      ),
    },
    {
      id: "status",
      accessorFn: (row) => row.status,
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge variant={row.original.status === "ACTIVE" ? "success" : "neutral"}>
          {row.original.status === "ACTIVE" ? "Active" : "Inactive"}
        </StatusBadge>
      ),
    },
    {
      id: "lastLogin",
      accessorFn: (row) => row.lastLogin ?? "",
      header: "Last login",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.lastLogin
            ? formatDistanceToNow(new Date(row.original.lastLogin), { addSuffix: true })
            : "Never"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const u = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Seller actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(u)}>
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onResetPassword(u)}>
                <KeyRound />
                Reset password
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onToggleStatus(u)}>
                {u.status === "ACTIVE" ? <UserX /> : <UserCheck />}
                {u.status === "ACTIVE" ? "Deactivate" : "Activate"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(u)}>
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
