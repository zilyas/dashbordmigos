import { Activity, Boxes, Database, Receipt, Store as StoreIcon, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatNumber } from "@/lib/format";
import type { getSystemHealth } from "@/lib/queries/security";

export function SystemHealthCard({ health }: { health: Awaited<ReturnType<typeof getSystemHealth>> }) {
  const stats = [
    { label: "Stores", value: health.storeCount, icon: <StoreIcon /> },
    { label: "Users", value: health.userCount, icon: <Users /> },
    { label: "Products", value: health.productCount, icon: <Boxes /> },
    { label: "Sales", value: health.saleCount, icon: <Receipt /> },
    { label: "Active sessions", value: health.activeSessionCount, icon: <Activity /> },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-col items-start gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>System health</CardTitle>
          <CardDescription>Database connectivity and platform-wide row counts.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge variant={health.dbOk ? "success" : "destructive"}>
            <Database className="size-3" />
            {health.dbOk ? `Connected · ${health.latencyMs}ms` : "Unreachable"}
          </StatusBadge>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 pt-4 sm:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
              {stat.icon}
              {stat.label}
            </span>
            <span className="text-xl font-semibold tabular-nums">{formatNumber(stat.value)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
