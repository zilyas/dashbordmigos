"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { MonitorSmartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatDateTime } from "@/lib/format";
import { terminateAllOtherSessions, terminateSession } from "@/actions/account";

export type SessionRow = {
  id: string;
  tokenId: string;
  ipAddress: string | null;
  browser: string | null;
  os: string | null;
  rememberMe: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

export function SessionsList({ sessions, currentSid }: { sessions: SessionRow[]; currentSid: string }) {
  const t = useTranslations("account.sessions");
  const [isPending, startTransition] = useTransition();
  const [terminateTarget, setTerminateTarget] = useState<SessionRow | null>(null);
  const [terminateAllOpen, setTerminateAllOpen] = useState(false);

  function handleTerminate(id: string) {
    startTransition(async () => {
      const result = await terminateSession(id);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toastTerminated"));
    });
  }

  function handleTerminateAll() {
    startTransition(async () => {
      const result = await terminateAllOtherSessions();
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toastAllTerminated"));
    });
  }

  const otherSessionCount = sessions.filter((s) => s.tokenId !== currentSid).length;

  return (
    <Card>
      <CardHeader className="flex flex-col items-start gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        {otherSessionCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => setTerminateAllOpen(true)}
          >
            {t("signOutOthers")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col divide-y pt-4">
        {sessions.map((session) => {
          const isCurrent = session.tokenId === currentSid;
          return (
            <div key={session.id} className="flex items-center gap-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <MonitorSmartphone className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="truncate">
                      {session.browser ?? t("unknownBrowser")} · {session.os ?? t("unknownOs")}
                    </span>
                    {isCurrent && <StatusBadge variant="success">{t("thisDevice")}</StatusBadge>}
                    {session.rememberMe && <StatusBadge variant="neutral">{t("remembered")}</StatusBadge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {session.ipAddress ?? t("unknownIp")} · {t("lastActive", { date: formatDateTime(session.lastSeenAt) })}
                  </p>
                </div>
              </div>
              {!isCurrent && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-destructive hover:text-destructive"
                  disabled={isPending}
                  onClick={() => setTerminateTarget(session)}
                >
                  {t("signOut")}
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>

      {terminateTarget && (
        <ConfirmDialog
          open={!!terminateTarget}
          onOpenChange={(open) => !open && setTerminateTarget(null)}
          title={t("terminateOneTitle")}
          description={t("terminateOneDescription", {
            browser: terminateTarget.browser ?? t("unknownBrowser"),
            os: terminateTarget.os ?? t("unknownOs"),
          })}
          confirmLabel={t("terminateConfirm")}
          destructive
          onConfirm={() => handleTerminate(terminateTarget.id)}
        />
      )}

      <ConfirmDialog
        open={terminateAllOpen}
        onOpenChange={setTerminateAllOpen}
        title={t("terminateAllTitle")}
        description={t("terminateAllDescription")}
        confirmLabel={t("terminateAllConfirm")}
        destructive
        onConfirm={handleTerminateAll}
      />
    </Card>
  );
}
