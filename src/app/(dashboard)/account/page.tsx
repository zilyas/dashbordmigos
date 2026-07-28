import type { Metadata } from "next";
import { KeyRound, ShieldCheck, History, MonitorSmartphone, UserRound } from "lucide-react";
import { getSessionContext } from "@/lib/store-context";
import { getMyActiveSessions, getMyLoginHistory, getMyProfile } from "@/lib/queries/account";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileCard } from "@/components/account/profile-card";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { TwoFactorSection } from "@/components/account/two-factor-section";
import { SessionsList, type SessionRow } from "@/components/account/sessions-list";
import { LoginHistoryTable } from "@/components/account/login-history-table";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const context = await getSessionContext();
  const sid = context!.sid;

  const [profile, sessions] = await Promise.all([
    getMyProfile(context!.userId),
    getMyActiveSessions(context!.userId),
  ]);

  const history = await getMyLoginHistory(profile.email, 20);

  const sessionRows: SessionRow[] = sessions.map((s) => ({
    id: s.id,
    tokenId: s.tokenId,
    ipAddress: s.ipAddress,
    browser: s.browser,
    os: s.os,
    rememberMe: s.rememberMe,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Account" description="Manage your profile, security and active sessions." />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">
            <UserRound />
            Profile
          </TabsTrigger>
          <TabsTrigger value="password">
            <KeyRound />
            Password
          </TabsTrigger>
          <TabsTrigger value="two-factor">
            <ShieldCheck />
            Two-Factor
          </TabsTrigger>
          <TabsTrigger value="sessions">
            <MonitorSmartphone />
            Sessions
          </TabsTrigger>
          <TabsTrigger value="history">
            <History />
            Login History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <ProfileCard
            name={profile.name}
            email={profile.email}
            role={profile.role}
            storeName={profile.store?.name ?? null}
            avatar={profile.avatar}
            createdAt={profile.createdAt}
            lastLogin={profile.lastLogin}
          />
        </TabsContent>

        <TabsContent value="password" className="mt-4">
          <ChangePasswordForm />
        </TabsContent>

        <TabsContent value="two-factor" className="mt-4">
          <TwoFactorSection initiallyEnabled={profile.twoFactorCredential?.enabled ?? false} />
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <SessionsList sessions={sessionRows} currentSid={sid} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <LoginHistoryTable attempts={history} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
