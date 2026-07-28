"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { History } from "lucide-react";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { describeActivity } from "@/lib/activity-format";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/labels";
import type { ActivityLogRow } from "@/lib/queries/activity";

export function ActivityTable({
  logs,
  showStore = false,
}: {
  logs: ActivityLogRow[];
  showStore?: boolean;
}) {
  const columns = useMemo<ColumnDef<ActivityLogRow, unknown>[]>(() => {
    const cols: ColumnDef<ActivityLogRow, unknown>[] = [
      {
        id: "user",
        accessorFn: (row) => row.userName,
        header: "User",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.userName}</span>
            <StatusBadge variant="neutral">{ROLE_LABELS[row.original.userRole]}</StatusBadge>
          </div>
        ),
      },
    ];

    if (showStore) {
      cols.push({
        id: "store",
        accessorFn: (row) => row.storeName ?? "",
        header: "Store",
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.storeName ?? "—"}</span>
        ),
      });
    }

    cols.push(
      {
        id: "action",
        accessorFn: (row) => describeActivity(row.action, row.entity, row.metadata),
        header: "Action",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {describeActivity(row.original.action, row.original.entity, row.original.metadata)}
          </span>
        ),
      },
      {
        id: "entity",
        accessorFn: (row) => row.entity,
        header: "Entity",
      },
      {
        id: "createdAt",
        accessorFn: (row) => row.createdAt,
        header: "Date",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>
        ),
      }
    );

    return cols;
  }, [showStore]);

  return (
    <DataTable
      columns={columns}
      data={logs}
      searchPlaceholder="Search activity..."
      emptyIcon={<History />}
      emptyTitle="No activity yet"
      pageSize={20}
    />
  );
}
