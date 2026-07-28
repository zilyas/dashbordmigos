import { prisma } from "@/lib/prisma";

export async function getBackupHistory() {
  return prisma.backupRecord.findMany({
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true, email: true } } },
  });
}
