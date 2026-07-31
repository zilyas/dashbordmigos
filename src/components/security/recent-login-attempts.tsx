import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateTime } from "@/lib/format";
import { FAIL_REASON_LABELS } from "@/lib/labels";
import { History } from "lucide-react";

export function RecentLoginAttempts({
  attempts,
}: {
  attempts: {
    id: string;
    email: string;
    success: boolean;
    ipAddress: string | null;
    failReason: string | null;
    createdAt: Date;
  }[];
}) {
  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>Recent login attempts</CardTitle>
        <CardDescription>Platform-wide, most recent first.</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {attempts.length === 0 ? (
          <EmptyState icon={<History />} title="No login attempts yet" className="border-none py-10" />
        ) : (
          <div className="flex max-h-96 flex-col divide-y overflow-y-auto">
            {attempts.map((attempt) => (
              <div key={attempt.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <StatusBadge variant={attempt.success ? "success" : "destructive"} className="shrink-0">
                      {attempt.success ? "Success" : "Failed"}
                    </StatusBadge>
                    <span className="truncate">{attempt.email}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {attempt.ipAddress ?? "Unknown IP"}
                    {attempt.failReason ? ` · ${FAIL_REASON_LABELS[attempt.failReason] ?? attempt.failReason}` : ""}
                    {" · "}
                    {formatDateTime(attempt.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
