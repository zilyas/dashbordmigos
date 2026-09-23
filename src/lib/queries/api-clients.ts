import { prisma } from "@/lib/prisma";

export async function getApiClients(storeId: string) {
  return prisma.apiClient.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    // Explicit select, never `keyHash`: this list feeds a Client Component, so
    // anything selected here is serialised into the RSC payload and shipped to
    // the browser. A leaked hash is offline-crackable material.
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      status: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });
}

export type ApiClientItem = Awaited<ReturnType<typeof getApiClients>>[number];
