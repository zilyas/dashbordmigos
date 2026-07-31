import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ROLE_LABELS } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { Role } from "@/generated/prisma/enums";

export function LockedAccountsCard({
  accounts,
}: {
  accounts: { id: string; name: string; email: string; role: Role; lockedUntil: Date | null; failedLoginAttempts: number }[];
}) {
  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>Locked accounts</CardTitle>
        <CardDescription>Accounts currently locked out after repeated failed sign-in attempts.</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {accounts.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title="No locked accounts" className="border-none py-10" />
        ) : (
          <div className="flex flex-col divide-y">
            {accounts.map((account) => (
              <div key={account.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldAlert className="size-4 shrink-0 text-destructive" />
                    <span className="truncate">{account.name}</span>
                    <StatusBadge variant="neutral" className="shrink-0">
                      {ROLE_LABELS[account.role]}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {account.email} · {account.failedLoginAttempts} failed attempts
                    {account.lockedUntil ? ` · locked until ${formatDateTime(account.lockedUntil)}` : ""}
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
