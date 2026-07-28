import { prisma } from "@/lib/prisma";

/** `storeId: null` (Super Admin only) returns activity across every store. */
export async function getActivityLogs(storeId: string | null, limit = 300) {
  const logs = await prisma.activityLog.findMany({
    where: storeId ? { storeId } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      user: { select: { name: true, role: true } },
      store: { select: { name: true } },
    },
  });

  return logs.map((l) => ({
    id: l.id,
    action: l.action,
    entity: l.entity,
    entityId: l.entityId,
    userName: l.user.name,
    userRole: l.user.role,
    storeName: l.store?.name ?? null,
    metadata: l.metadata as Record<string, unknown> | null,
    createdAt: l.createdAt.toISOString(),
  }));
}

export type ActivityLogRow = Awaited<ReturnType<typeof getActivityLogs>>[number];
