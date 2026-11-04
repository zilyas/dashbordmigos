import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionMatrix } from "@/components/security/permission-matrix";
import { SystemHealthCard } from "@/components/security/system-health-card";
import { LockedAccountsCard } from "@/components/security/locked-accounts-card";
import { RecentLoginAttempts } from "@/components/security/recent-login-attempts";
import { getLockedAccounts, getRecentLoginAttempts, getSystemHealth } from "@/lib/queries/security";
import { getSessionContext } from "@/lib/store-context";
import { toAppLocale } from "@/i18n/messages";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const context = await getSessionContext();
  const locale = toAppLocale(context?.locale);
  const t = await getTranslations({ locale, namespace: "security.page" });
  const [health, lockedAccounts, recentAttempts] = await Promise.all([
    getSystemHealth(),
    getLockedAccounts(),
    getRecentLoginAttempts(30),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <SystemHealthCard health={health} locale={locale} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LockedAccountsCard accounts={lockedAccounts} locale={locale} />
        <RecentLoginAttempts attempts={recentAttempts} locale={locale} />
      </div>
      <PermissionMatrix locale={locale} />
    </div>
  );
}
