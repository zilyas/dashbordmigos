"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
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
      toast.success("Session terminated");
    });
  }

  function handleTerminateAll() {
    startTransition(async () => {
      const result = await terminateAllOtherSessions();
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Signed out of all other sessions");
    });
  }

  const otherSessionCount = sessions.filter((s) => s.tokenId !== currentSid).length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between border-b pb-4">
        <div>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>Devices and browsers currently signed in to your account.</CardDescription>
        </div>
        {otherSessionCount > 0 && (
          <Button variant="outline" size="sm" onClick={() => setTerminateAllOpen(true)}>
            Sign out other sessions
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col divide-y pt-4">
        {sessions.map((session) => {
          const isCurrent = session.tokenId === currentSid;
          return (
            <div key={session.id} className="flex items-center justify-between gap-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <MonitorSmartphone className="size-4 text-muted-foreground" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {session.browser ?? "Unknown browser"} · {session.os ?? "Unknown OS"}
                    {isCurrent && <StatusBadge variant="success">This device</StatusBadge>}
                    {session.rememberMe && <StatusBadge variant="neutral">Remembered</StatusBadge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {session.ipAddress ?? "Unknown IP"} · Last active {formatDateTime(session.lastSeenAt)}
                  </p>
                </div>
              </div>
              {!isCurrent && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={isPending}
                  onClick={() => setTerminateTarget(session)}
                >
                  Sign out
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
          title="Sign out this session?"
          description={`This immediately signs out ${terminateTarget.browser ?? "this device"} on ${terminateTarget.os ?? "an unknown OS"}.`}
          confirmLabel="Sign out"
          destructive
          onConfirm={() => handleTerminate(terminateTarget.id)}
        />
      )}

      <ConfirmDialog
        open={terminateAllOpen}
        onOpenChange={setTerminateAllOpen}
        title="Sign out all other sessions?"
        description="This immediately signs you out everywhere except this device."
        confirmLabel="Sign out others"
        destructive
        onConfirm={handleTerminateAll}
      />
    </Card>
  );
}
