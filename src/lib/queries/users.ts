import { prisma } from "@/lib/prisma";

/** A Manager's Seller roster, scoped to their store. */
export async function getSellers(storeId: string) {
  const sellers = await prisma.user.findMany({
    where: { storeId, role: "SELLER" },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { sales: true } },
      sales: { select: { total: true } },
    },
  });

  return sellers.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone,
    avatar: u.avatar,
    status: u.status,
    lastLogin: u.lastLogin ? u.lastLogin.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    salesCount: u._count.sales,
    salesTotal: u.sales.reduce((sum, s) => sum + Number(s.total), 0),
  }));
}

export type SellerListItem = Awaited<ReturnType<typeof getSellers>>[number];

/** Platform-wide Manager roster, Super Admin only. */
export async function getManagers() {
  const managers = await prisma.user.findMany({
    where: { role: "MANAGER" },
    orderBy: { createdAt: "desc" },
    include: { store: { select: { id: true, name: true, code: true } } },
  });

  return managers.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    avatar: u.avatar,
    status: u.status,
    lastLogin: u.lastLogin ? u.lastLogin.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    storeId: u.store?.id ?? null,
    storeName: u.store?.name ?? null,
    storeCode: u.store?.code ?? null,
  }));
}

export type ManagerListItem = Awaited<ReturnType<typeof getManagers>>[number];
