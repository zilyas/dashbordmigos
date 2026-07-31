import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDateTime } from "@/lib/format";
import { FAIL_REASON_LABELS } from "@/lib/labels";
import { History } from "lucide-react";

export function LoginHistoryTable({
  attempts,
}: {
  attempts: { id: string; success: boolean; ipAddress: string | null; userAgent: string | null; failReason: string | null; createdAt: Date }[];
}) {
  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>Login history</CardTitle>
        <CardDescription>Recent sign-in attempts on your account.</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {attempts.length === 0 ? (
          <EmptyState icon={<History />} title="No login attempts yet" className="border-none py-10" />
        ) : (
          <div className="flex flex-col divide-y">
            {attempts.map((attempt) => (
              <div key={attempt.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <StatusBadge variant={attempt.success ? "success" : "destructive"} className="shrink-0">
                      {attempt.success ? "Success" : "Failed"}
                    </StatusBadge>
                    {attempt.failReason && (
                      <span className="truncate text-xs text-muted-foreground">
                        {FAIL_REASON_LABELS[attempt.failReason] ?? attempt.failReason}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {attempt.ipAddress ?? "Unknown IP"} · {formatDateTime(attempt.createdAt)}
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
