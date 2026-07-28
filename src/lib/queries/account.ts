import { prisma } from "@/lib/prisma";

export async function getMyProfile(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { store: { select: { name: true } }, twoFactorCredential: { select: { enabled: true } } },
  });
}

export async function getMyActiveSessions(userId: string) {
  return prisma.userSession.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: "desc" },
  });
}

export async function getMyLoginHistory(email: string, limit = 20) {
  return prisma.loginAttempt.findMany({
    where: { email: email.toLowerCase() },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
