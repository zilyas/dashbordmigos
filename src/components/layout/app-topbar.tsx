"use client";

import { Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { NotificationsMenu, type NotificationItem } from "@/components/layout/notifications-menu";
import { UserMenu } from "@/components/layout/user-menu";
import { useCommandPalette } from "@/components/layout/command-palette";
import type { Role } from "@/generated/prisma/enums";

export function AppTopbar({
  user,
  notifications,
}: {
  user: { name: string; email: string; role: Role; avatar?: string | null };
  notifications: NotificationItem[];
}) {
  const { setOpen } = useCommandPalette();
  const isMac =
    typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("mac");

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur supports-backdrop-filter:bg-background/60">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-5" />

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full max-w-72 items-center gap-2 rounded-lg border bg-muted/40 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Search...</span>
        <kbd className="hidden rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <NotificationsMenu notifications={notifications} />
        <Separator orientation="vertical" className="mx-1 h-5" />
        <UserMenu name={user.name} email={user.email} role={user.role} avatar={user.avatar} />
      </div>
    </header>
  );
}
