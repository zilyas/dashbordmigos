import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateTime } from "@/lib/format";
import { History } from "lucide-react";

const FAIL_REASON_LABELS: Record<string, string> = {
  invalid_credentials: "Invalid email or password",
  account_locked: "Account locked",
  rate_limited: "Rate limited",
  two_factor_required: "Two-factor code required",
  invalid_two_factor_code: "Invalid two-factor code",
};

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
              <div key={attempt.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <StatusBadge variant={attempt.success ? "success" : "destructive"}>
                      {attempt.success ? "Success" : "Failed"}
                    </StatusBadge>
                    {attempt.email}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
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
