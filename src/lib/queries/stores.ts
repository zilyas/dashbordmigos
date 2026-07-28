import { startOfDay, startOfMonth } from "date-fns";
import { prisma } from "@/lib/prisma";

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

export async function getStores() {
  const stores = await prisma.store.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      users: { where: { role: "MANAGER" }, select: { id: true, name: true, email: true }, take: 1 },
      _count: { select: { products: true, users: true } },
    },
  });

  return stores.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    currency: s.currency,
    taxRate: Number(s.taxRate),
    address: s.address,
    city: s.city,
    country: s.country,
    phone: s.phone,
    email: s.email,
    logo: s.logo,
    status: s.status,
    managerName: s.users[0]?.name ?? null,
    managerEmail: s.users[0]?.email ?? null,
    productCount: s._count.products,
    employeeCount: s._count.users,
    createdAt: s.createdAt.toISOString(),
  }));
}

export type StoreListItem = Awaited<ReturnType<typeof getStores>>[number];

export async function getStoreById(id: string) {
  const store = await prisma.store.findUnique({ where: { id } });
  if (!store) return null;

  return {
    id: store.id,
    name: store.name,
    code: store.code,
    currency: store.currency,
    taxRate: Number(store.taxRate),
    allowSellerViewCost: store.allowSellerViewCost,
    address: store.address,
    city: store.city,
    country: store.country,
    phone: store.phone,
    email: store.email,
    logo: store.logo,
    status: store.status,
  };
}

export type StoreDetail = Awaited<ReturnType<typeof getStoreById>>;

export async function getStoreStats(storeId: string) {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const todayStart = startOfDay(now);

  const [monthAgg, todayAgg, inventoryAgg, manager, employeeCount, recentSales] = await Promise.all([
    prisma.sale.aggregate({
      where: { storeId, createdAt: { gte: monthStart } },
      _sum: { total: true, netProfit: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { storeId, createdAt: { gte: todayStart } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.product.findMany({
      where: { storeId, status: "ACTIVE" },
      select: { stock: true, sellingPrice: true },
    }),
    prisma.user.findFirst({
      where: { storeId, role: "MANAGER" },
      select: { id: true, name: true, email: true },
    }),
    prisma.user.count({ where: { storeId } }),
    prisma.sale.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { seller: { select: { name: true } } },
    }),
  ]);

  const inventoryValue = inventoryAgg.reduce(
    (sum, p) => sum + p.stock * Number(p.sellingPrice),
    0
  );

  return {
    monthlyRevenue: toNumber(monthAgg._sum.total),
    monthlyProfit: toNumber(monthAgg._sum.netProfit),
    monthlyOrders: monthAgg._count,
    todayRevenue: toNumber(todayAgg._sum.total),
    todayOrders: todayAgg._count,
    inventoryValue: Math.round(inventoryValue * 100) / 100,
    employeeCount,
    manager,
    recentSales: recentSales.map((s) => ({
      id: s.id,
      invoiceNumber: s.invoiceNumber,
      sellerName: s.seller.name,
      total: toNumber(s.total),
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

export type StoreStats = Awaited<ReturnType<typeof getStoreStats>>;

/** For "assign/transfer manager" store pickers. */
export async function getStoresForPicker() {
  const stores = await prisma.store.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });
  return stores;
}
