import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSessionContext } from "@/lib/store-context";
import { prisma } from "@/lib/prisma";
import { getTotalUnreadMessageCount } from "@/lib/queries/messages";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";
import { CommandPaletteProvider } from "@/components/layout/command-palette";
import { PageTransition } from "@/components/layout/page-transition";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Revocation ("terminate session" / "log out everywhere") is only ever
  // checked here, not in edge middleware — see getSessionContext().
  const context = await getSessionContext();
  if (!context) {
    redirect("/login");
  }

  const [notificationRows, unreadMessageCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    getTotalUnreadMessageCount(session.user.id),
  ]);

  const notifications = notificationRows.map((n) => ({
    id: n.id,
    title: n.title,
    message: n.message,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
    type: n.type,
  }));

  return (
    <SidebarProvider>
      <CommandPaletteProvider role={session.user.role}>
        <AppSidebar role={session.user.role} unreadMessageCount={unreadMessageCount} />
        <SidebarInset>
          <AppTopbar
            user={{
              name: session.user.name ?? "User",
              email: session.user.email ?? "",
              role: session.user.role,
              avatar: session.user.image,
            }}
            notifications={notifications}
          />
          <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <PageTransition>{children}</PageTransition>
          </main>
        </SidebarInset>
      </CommandPaletteProvider>
    </SidebarProvider>
  );
}
