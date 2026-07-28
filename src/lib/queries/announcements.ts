import { prisma } from "@/lib/prisma";

const ANNOUNCEMENT_INCLUDE = {
  announcement: { include: { createdBy: { select: { name: true, role: true } } } },
} as const;

export async function getAnnouncementsForUser(userId: string, limit = 50) {
  return prisma.announcementRecipient.findMany({
    where: { userId },
    orderBy: { announcement: { createdAt: "desc" } },
    take: limit,
    include: ANNOUNCEMENT_INCLUDE,
  });
}

export async function getUnreadAnnouncementsForUser(userId: string, limit = 5) {
  return prisma.announcementRecipient.findMany({
    where: { userId, readAt: null },
    orderBy: { announcement: { createdAt: "desc" } },
    take: limit,
    include: ANNOUNCEMENT_INCLUDE,
  });
}

export async function getUnreadAnnouncementCount(userId: string) {
  return prisma.announcementRecipient.count({ where: { userId, readAt: null } });
}
