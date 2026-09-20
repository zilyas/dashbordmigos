import type { NotificationType } from "@/generated/prisma/enums";

/**
 * Where a notification takes you when you click it. Notifications have no link
 * column, and adding one would need a migration plus a backfill for every row
 * already in the table — the type alone is enough to reach the right page,
 * because each type is produced by exactly one feature.
 *
 * ponytail: a type-to-route map, not a per-row deep link. A LOW_STOCK item
 * opens the product list, not that one product. Add a `Notification.href`
 * column when a notification must point at a specific record.
 */
const TYPE_HREF: Record<NotificationType, string> = {
  LOW_STOCK: "/products",
  NEW_SALE: "/sales",
  SYSTEM: "/notifications",
  USER: "/users",
  NEW_MESSAGE: "/messages",
  NEW_ANNOUNCEMENT: "/announcements",
  SELLER_ADDED: "/users",
  MANAGER_ASSIGNED: "/managers",
  PASSWORD_CHANGED: "/security",
  STORE_CREATED: "/stores",
  SYSTEM_ALERT: "/notifications",
  EXPIRING_STOCK: "/reports/expiry",
  EXPIRED_STOCK: "/reports/expiry",
};

export function notificationHref(type: NotificationType): string {
  return TYPE_HREF[type] ?? "/notifications";
}
