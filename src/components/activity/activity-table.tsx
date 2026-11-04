"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { History } from "lucide-react";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { describeActivity } from "@/lib/activity-format";
import { formatDateTime } from "@/lib/format";
import { roleLabel } from "@/lib/labels";
import type { ActivityLogRow } from "@/lib/queries/activity";

export function ActivityTable({
  logs,
  showStore = false,
}: {
  logs: ActivityLogRow[];
  showStore?: boolean;
}) {
  const tLabels = useTranslations("labels");
  const t = useTranslations("activity.table");
  const tActivity = useTranslations("activity");
  const columns = useMemo<ColumnDef<ActivityLogRow, unknown>[]>(() => {
    const cols: ColumnDef<ActivityLogRow, unknown>[] = [
      {
        id: "user",
        accessorFn: (row) => row.userName,
        header: t("columns.user"),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.userName}</span>
            <StatusBadge variant="neutral">{roleLabel(tLabels, row.original.userRole)}</StatusBadge>
          </div>
        ),
      },
    ];

    if (showStore) {
      cols.push({
        id: "store",
        accessorFn: (row) => row.storeName ?? "",
        header: t("columns.store"),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.storeName ?? "—"}</span>
        ),
      });
    }

    cols.push(
      {
        id: "action",
        accessorFn: (row) => describeActivity(tActivity, tLabels, row.action, row.entity, row.metadata),
        header: t("columns.action"),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {describeActivity(tActivity, tLabels, row.original.action, row.original.entity, row.original.metadata)}
          </span>
        ),
      },
      {
        id: "entity",
        accessorFn: (row) => row.entity,
        header: t("columns.entity"),
      },
      {
        id: "createdAt",
        accessorFn: (row) => row.createdAt,
        header: t("columns.date"),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>
        ),
      }
    );

    return cols;
  }, [showStore, tLabels, t, tActivity]);

  return (
    <DataTable
      columns={columns}
      data={logs}
      searchPlaceholder={t("searchPlaceholder")}
      emptyIcon={<History />}
      emptyTitle={t("emptyTitle")}
      pageSize={20}
    />
  );
}
