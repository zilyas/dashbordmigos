"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  KeyRound,
  Megaphone,
  MessageSquare,
  PackageX,
  Receipt,
  ShieldAlert,
  Store,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { markAllNotificationsRead, markNotificationRead } from "@/actions/notifications";
import { cn } from "@/lib/utils";
import type { NotificationType } from "@/generated/prisma/enums";

const TYPE_ICON: Record<NotificationType, React.ReactNode> = {
  LOW_STOCK: <AlertTriangle className="size-3.5" />,
  NEW_SALE: <Receipt className="size-3.5" />,
  SYSTEM: <Bell className="size-3.5" />,
  USER: <UserPlus className="size-3.5" />,
  NEW_MESSAGE: <MessageSquare className="size-3.5" />,
  NEW_ANNOUNCEMENT: <Megaphone className="size-3.5" />,
  SELLER_ADDED: <UserPlus className="size-3.5" />,
  MANAGER_ASSIGNED: <UserPlus className="size-3.5" />,
  PASSWORD_CHANGED: <KeyRound className="size-3.5" />,
  STORE_CREATED: <Store className="size-3.5" />,
  SYSTEM_ALERT: <ShieldAlert className="size-3.5" />,
};

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  type: NotificationType;
};

export function NotificationsMenu({ notifications }: { notifications: NotificationItem[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const unreadCount = notifications.filter((n) => !n.read).length;

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllNotificationsRead();
    });
  }

  function handleItemClick(notification: NotificationItem) {
    if (notification.read) return;
    startTransition(async () => {
      await markNotificationRead(notification.id);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label="Notifications">
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[calc(100vw-2rem)] p-0 sm:w-80">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <span className="text-sm font-medium">Notifications</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
              disabled={isPending}
              onClick={handleMarkAllRead}
            >
              <CheckCheck className="size-3.5" />
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <PackageX className="size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  className={cn(
                    "flex items-start gap-2.5 border-b px-3 py-2.5 last:border-b-0",
                    !n.read && "cursor-pointer bg-primary/5 hover:bg-primary/10"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
                      n.read ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                    )}
                  >
                    {TYPE_ICON[n.type]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {!n.read && <span className="size-1.5 rounded-full bg-primary" />}
                      <span className="text-sm font-medium">{n.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{n.message}</p>
                    <span className="text-[11px] text-muted-foreground/70">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        <div className="border-t p-2">
          <Button asChild variant="ghost" size="sm" className="w-full text-xs" onClick={() => setOpen(false)}>
            <Link href="/notifications">View all notifications</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
