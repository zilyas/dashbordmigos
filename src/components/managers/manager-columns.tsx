"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal, Pencil, KeyRound, UserCheck, UserX, Trash2, ArrowLeftRight } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/shared/status-badge";
import { initials } from "@/lib/utils";
import type { ManagerListItem } from "@/lib/queries/users";

export function buildManagerColumns({
  onEdit,
  onTransfer,
  onResetPassword,
  onToggleStatus,
  onDelete,
}: {
  onEdit: (manager: ManagerListItem) => void;
  onTransfer: (manager: ManagerListItem) => void;
  onResetPassword: (manager: ManagerListItem) => void;
  onToggleStatus: (manager: ManagerListItem) => void;
  onDelete: (manager: ManagerListItem) => void;
}): ColumnDef<ManagerListItem, unknown>[] {
  return [
    {
      id: "manager",
      accessorFn: (row) => `${row.name} ${row.email}`,
      header: "Manager",
      cell: ({ row }) => {
        const m = row.original;
        return (
          <div className="flex items-center gap-3 py-1">
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                {initials(m.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium">{m.name}</p>
              <p className="truncate text-xs text-muted-foreground">{m.email}</p>
            </div>
          </div>
        );
      },
    },
    {
      id: "store",
      accessorFn: (row) => row.storeName ?? "",
      header: "Store",
      cell: ({ row }) =>
        row.original.storeName ? (
          <StatusBadge variant="neutral">{row.original.storeName}</StatusBadge>
        ) : (
          <StatusBadge variant="warning">Unassigned</StatusBadge>
        ),
    },
    {
      id: "phone",
      accessorFn: (row) => row.phone ?? "",
      header: "Phone",
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.phone || "—"}</span>,
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
        const m = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Manager actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(m)}>
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onTransfer(m)}>
                <ArrowLeftRight />
                Transfer to another store
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onResetPassword(m)}>
                <KeyRound />
                Reset password
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onToggleStatus(m)}>
                {m.status === "ACTIVE" ? <UserX /> : <UserCheck />}
                {m.status === "ACTIVE" ? "Deactivate" : "Activate"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(m)}>
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
