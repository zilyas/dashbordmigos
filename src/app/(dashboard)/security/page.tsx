import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionMatrix } from "@/components/security/permission-matrix";
import { SystemHealthCard } from "@/components/security/system-health-card";
import { LockedAccountsCard } from "@/components/security/locked-accounts-card";
import { RecentLoginAttempts } from "@/components/security/recent-login-attempts";
import { getLockedAccounts, getRecentLoginAttempts, getSystemHealth } from "@/lib/queries/security";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const [health, lockedAccounts, recentAttempts] = await Promise.all([
    getSystemHealth(),
    getLockedAccounts(),
    getRecentLoginAttempts(30),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Security" description="Platform-wide security posture, at a glance." />
      <SystemHealthCard health={health} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LockedAccountsCard accounts={lockedAccounts} />
        <RecentLoginAttempts attempts={recentAttempts} />
      </div>
      <PermissionMatrix />
    </div>
  );
}
