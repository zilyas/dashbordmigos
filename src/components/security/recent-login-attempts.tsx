import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateTime } from "@/lib/format";
import { failReasonLabel } from "@/lib/labels";
import { History } from "lucide-react";
import type { AppLocale } from "@/i18n/messages";

export async function RecentLoginAttempts({
  attempts,
  locale,
}: {
  attempts: {
    id: string;
    email: string;
    success: boolean;
    ipAddress: string | null;
    failReason: string | null;
    createdAt: Date;
  }[];
  locale: AppLocale;
}) {
  const t = await getTranslations({ locale, namespace: "labels" });
  const tCard = await getTranslations({ locale, namespace: "security.recentLoginAttempts" });
  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>{tCard("title")}</CardTitle>
        <CardDescription>{tCard("description")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {attempts.length === 0 ? (
          <EmptyState icon={<History />} title={tCard("emptyTitle")} className="border-none py-10" />
        ) : (
          <div className="flex max-h-96 flex-col divide-y overflow-y-auto">
            {attempts.map((attempt) => (
              <div key={attempt.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <StatusBadge variant={attempt.success ? "success" : "destructive"} className="shrink-0">
                      {attempt.success ? tCard("success") : tCard("failed")}
                    </StatusBadge>
                    <span className="truncate">{attempt.email}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {attempt.ipAddress ?? tCard("unknownIp")}
                    {attempt.failReason ? ` · ${failReasonLabel(t, attempt.failReason)}` : ""}
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
