import { prisma } from "@/lib/prisma";

export const NOTIFICATIONS_PAGE_SIZE = 20;

export async function getNotificationsPage(userId: string, page: number) {
  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * NOTIFICATIONS_PAGE_SIZE,
      take: NOTIFICATIONS_PAGE_SIZE,
    }),
    prisma.notification.count({ where: { userId } }),
  ]);
  return { notifications, total };
}
