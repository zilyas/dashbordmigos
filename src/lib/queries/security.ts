import { prisma } from "@/lib/prisma";

export async function getSystemHealth() {
  const start = Date.now();
  let dbOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  const latencyMs = Date.now() - start;

  const [storeCount, userCount, productCount, saleCount, activeSessionCount] = await Promise.all([
    prisma.store.count(),
    prisma.user.count(),
    prisma.product.count(),
    prisma.sale.count(),
    prisma.userSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);

  return { dbOk, latencyMs, storeCount, userCount, productCount, saleCount, activeSessionCount };
}

export async function getRecentLoginAttempts(limit = 30) {
  return prisma.loginAttempt.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export async function getLockedAccounts() {
  return prisma.user.findMany({
    where: { lockedUntil: { gt: new Date() } },
    select: { id: true, name: true, email: true, role: true, lockedUntil: true, failedLoginAttempts: true },
    orderBy: { lockedUntil: "desc" },
  });
}
