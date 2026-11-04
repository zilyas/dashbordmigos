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
import { userStatusLabel } from "@/lib/labels";
import type { ManagerListItem } from "@/lib/queries/users";

export function buildManagerColumns({
  onEdit,
  onTransfer,
  onResetPassword,
  onToggleStatus,
  onDelete,
  t,
  tLabels,
}: {
  onEdit: (manager: ManagerListItem) => void;
  onTransfer: (manager: ManagerListItem) => void;
  onResetPassword: (manager: ManagerListItem) => void;
  onToggleStatus: (manager: ManagerListItem) => void;
  onDelete: (manager: ManagerListItem) => void;
  /** Resolved via useTranslations("people.managers.columns") in the caller. */
  t: (key: string) => string;
  /** Resolved via useTranslations("labels") in the caller. */
  tLabels: (key: string) => string;
}): ColumnDef<ManagerListItem, unknown>[] {
  return [
    {
      id: "manager",
      accessorFn: (row) => `${row.name} ${row.email}`,
      header: t("manager"),
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
      header: t("store"),
      cell: ({ row }) =>
        row.original.storeName ? (
          <StatusBadge variant="neutral">{row.original.storeName}</StatusBadge>
        ) : (
          <StatusBadge variant="warning">{t("unassigned")}</StatusBadge>
        ),
    },
    {
      id: "phone",
      accessorFn: (row) => row.phone ?? "",
      header: t("phone"),
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.phone || "—"}</span>,
    },
    {
      id: "status",
      accessorFn: (row) => row.status,
      header: t("status"),
      cell: ({ row }) => (
        <StatusBadge variant={row.original.status === "ACTIVE" ? "success" : "neutral"}>
          {userStatusLabel(tLabels, row.original.status)}
        </StatusBadge>
      ),
    },
    {
      id: "lastLogin",
      accessorFn: (row) => row.lastLogin ?? "",
      header: t("lastLogin"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.lastLogin
            ? formatDistanceToNow(new Date(row.original.lastLogin), { addSuffix: true })
            : t("never")}
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
              <Button variant="ghost" size="icon-sm" aria-label={t("actionsLabel")}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(m)}>
                <Pencil />
                {t("edit")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onTransfer(m)}>
                <ArrowLeftRight />
                {t("transfer")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onResetPassword(m)}>
                <KeyRound />
                {t("resetPassword")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onToggleStatus(m)}>
                {m.status === "ACTIVE" ? <UserX /> : <UserCheck />}
                {m.status === "ACTIVE" ? t("deactivate") : t("activate")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(m)}>
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
