"use client";

import { useTransition } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  KeyRound,
  Megaphone,
  MessageSquare,
  PackageX,
  Receipt,
  ShieldAlert,
  Store,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { deleteNotification, markNotificationRead } from "@/actions/notifications";
import { notificationHref } from "@/lib/notification-links";
import type { NotificationType } from "@/generated/prisma/enums";

const TYPE_ICON: Record<NotificationType, React.ReactNode> = {
  LOW_STOCK: <AlertTriangle className="size-4" />,
  NEW_SALE: <Receipt className="size-4" />,
  SYSTEM: <Bell className="size-4" />,
  USER: <UserPlus className="size-4" />,
  NEW_MESSAGE: <MessageSquare className="size-4" />,
  NEW_ANNOUNCEMENT: <Megaphone className="size-4" />,
  SELLER_ADDED: <UserPlus className="size-4" />,
  MANAGER_ASSIGNED: <UserPlus className="size-4" />,
  PASSWORD_CHANGED: <KeyRound className="size-4" />,
  STORE_CREATED: <Store className="size-4" />,
  SYSTEM_ALERT: <ShieldAlert className="size-4" />,
  EXPIRING_STOCK: <CalendarClock className="size-4" />,
  EXPIRED_STOCK: <PackageX className="size-4" />,
};

export type NotificationHistoryItem = {
  id: string;
  title: string;
  message: string;
  read: boolean;
  type: NotificationType;
  createdAt: string;
};

export function NotificationHistoryList({ notifications }: { notifications: NotificationHistoryItem[] }) {
  const [isPending, startTransition] = useTransition();

  // Only clears the unread flag — the <Link> does the navigating, so an
  // already-read row still goes somewhere when clicked.
  function handleClick(notification: NotificationHistoryItem) {
    if (notification.read) return;
    startTransition(async () => {
      await markNotificationRead(notification.id);
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteNotification(id);
    });
  }

  if (notifications.length === 0) {
    return <EmptyState icon={<PackageX />} title="No notifications" className="py-16" />;
  }

  return (
    <div className="flex flex-col divide-y rounded-xl border">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={cn(
            "flex items-start gap-3 px-4 py-3 transition-colors",
            !n.read && "bg-primary/5"
          )}
        >
          <Link
            href={notificationHref(n.type)}
            onClick={() => handleClick(n)}
            className="flex min-w-0 flex-1 items-start gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg",
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
              <p className="text-sm text-muted-foreground">{n.message}</p>
              <span className="text-xs text-muted-foreground/70">
                {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
              </span>
            </div>
          </Link>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isPending}
            onClick={() => handleDelete(n.id)}
            aria-label="Delete notification"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
