import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDateTime } from "@/lib/format";
import { failReasonLabel } from "@/lib/labels";
import { History } from "lucide-react";
import type { AppLocale } from "@/i18n/messages";

export async function LoginHistoryTable({
  attempts,
  locale,
}: {
  attempts: { id: string; success: boolean; ipAddress: string | null; userAgent: string | null; failReason: string | null; createdAt: Date }[];
  locale: AppLocale;
}) {
  const t = await getTranslations({ locale, namespace: "labels" });
  const tHistory = await getTranslations({ locale, namespace: "account.loginHistory" });
  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>{tHistory("title")}</CardTitle>
        <CardDescription>{tHistory("description")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {attempts.length === 0 ? (
          <EmptyState icon={<History />} title={tHistory("emptyTitle")} className="border-none py-10" />
        ) : (
          <div className="flex flex-col divide-y">
            {attempts.map((attempt) => (
              <div key={attempt.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <StatusBadge variant={attempt.success ? "success" : "destructive"} className="shrink-0">
                      {attempt.success ? tHistory("success") : tHistory("failed")}
                    </StatusBadge>
                    {attempt.failReason && (
                      <span className="truncate text-xs text-muted-foreground">
                        {failReasonLabel(t, attempt.failReason)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {attempt.ipAddress ?? tHistory("unknownIp")} · {formatDateTime(attempt.createdAt)}
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
