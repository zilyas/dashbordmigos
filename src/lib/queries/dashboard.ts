import { startOfDay, startOfMonth, subDays, subMonths, format } from "date-fns";
import { prisma } from "@/lib/prisma";

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

export async function getManagerDashboardData(storeId: string) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const monthStart = startOfMonth(now);
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const trendStart = subDays(todayStart, 13);
  const categoryWindowStart = subDays(todayStart, 29);

  const [
    todayAgg,
    monthAgg,
    lastMonthAgg,
    activeProducts,
    topSellerGroup,
    trendSales,
    categoryItems,
    bestSellingGroups,
    recentActivity,
  ] = await Promise.all([
    prisma.sale.aggregate({
      where: { storeId, createdAt: { gte: todayStart } },
      _sum: { total: true, netProfit: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { storeId, createdAt: { gte: monthStart } },
      _sum: { total: true, netProfit: true },
      _avg: { total: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { storeId, createdAt: { gte: lastMonthStart, lt: monthStart } },
      _sum: { total: true, netProfit: true },
    }),
    prisma.product.findMany({
      where: { storeId, status: "ACTIVE" },
      select: { stock: true, minimumStock: true },
    }),
    prisma.sale.groupBy({
      by: ["sellerId"],
      where: { storeId, createdAt: { gte: monthStart } },
      _sum: { total: true },
      orderBy: { _sum: { total: "desc" } },
      take: 1,
    }),
    prisma.sale.findMany({
      where: { storeId, createdAt: { gte: trendStart } },
      select: { createdAt: true, total: true, netProfit: true },
    }),
    prisma.saleItem.findMany({
      where: { sale: { storeId, createdAt: { gte: categoryWindowStart } } },
      select: {
        quantity: true,
        sellingPrice: true,
        product: { select: { category: { select: { name: true } } } },
      },
    }),
    prisma.saleItem.groupBy({
      by: ["productId"],
      where: { sale: { storeId, createdAt: { gte: categoryWindowStart } } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
    prisma.activityLog.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const topSeller = topSellerGroup[0]
    ? await prisma.user.findUnique({
        where: { id: topSellerGroup[0].sellerId },
        select: { name: true },
      })
    : null;

  const unitsInStock = activeProducts.reduce((sum, p) => sum + p.stock, 0);
  const lowStockCount = activeProducts.filter((p) => p.stock <= p.minimumStock).length;

  const bestSellingProducts = await prisma.product.findMany({
    where: { id: { in: bestSellingGroups.map((g) => g.productId) } },
    select: { id: true, name: true },
  });

  const revenueTrend: { date: string; revenue: number; profit: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const day = subDays(todayStart, 13 - i);
    const key = format(day, "MMM d");
    revenueTrend.push({ date: key, revenue: 0, profit: 0 });
  }
  for (const sale of trendSales) {
    const dayIndex = Math.floor(
      (startOfDay(sale.createdAt).getTime() - trendStart.getTime()) / 86_400_000
    );
    if (dayIndex >= 0 && dayIndex < 14) {
      revenueTrend[dayIndex].revenue += toNumber(sale.total);
      revenueTrend[dayIndex].profit += toNumber(sale.netProfit);
    }
  }

  const categoryTotals = new Map<string, number>();
  for (const item of categoryItems) {
    const name = item.product.category?.name ?? "Uncategorized";
    const revenue = toNumber(item.sellingPrice) * item.quantity;
    categoryTotals.set(name, (categoryTotals.get(name) ?? 0) + revenue);
  }
  const salesByCategory = Array.from(categoryTotals.entries())
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);

  const bestSellers = bestSellingGroups.map((g) => ({
    name: bestSellingProducts.find((p) => p.id === g.productId)?.name ?? "Unknown",
    quantity: g._sum.quantity ?? 0,
  }));

  const monthlyRevenue = toNumber(monthAgg._sum.total);
  const lastMonthRevenue = toNumber(lastMonthAgg._sum.total);
  const monthlyProfit = toNumber(monthAgg._sum.netProfit);
  const lastMonthProfit = toNumber(lastMonthAgg._sum.netProfit);

  function growth(current: number, previous: number) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  return {
    today: {
      revenue: toNumber(todayAgg._sum.total),
      profit: toNumber(todayAgg._sum.netProfit),
      orders: todayAgg._count,
    },
    monthly: {
      revenue: monthlyRevenue,
      profit: monthlyProfit,
      revenueGrowth: growth(monthlyRevenue, lastMonthRevenue),
      profitGrowth: growth(monthlyProfit, lastMonthProfit),
      averageOrder: toNumber(monthAgg._avg.total),
      orders: monthAgg._count,
    },
    stock: {
      unitsInStock,
      lowStockCount,
    },
    topSeller: topSeller?.name ?? "—",
    revenueTrend,
    salesByCategory,
    bestSellers,
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      action: a.action,
      entity: a.entity,
      userName: a.user.name,
      createdAt: a.createdAt.toISOString(),
      metadata: a.metadata as Record<string, unknown> | null,
    })),
  };
}

export async function getSellerDashboardData(userId: string, storeId: string) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const monthStart = startOfMonth(now);

  const [todayAgg, monthAgg, recentSales, activeProducts] = await Promise.all([
    prisma.sale.aggregate({
      where: { sellerId: userId, createdAt: { gte: todayStart } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { sellerId: userId, createdAt: { gte: monthStart } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.findMany({
      where: { sellerId: userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        invoiceNumber: true,
        total: true,
        customerName: true,
        paymentMethod: true,
        createdAt: true,
      },
    }),
    prisma.product.findMany({
      where: { storeId, status: "ACTIVE" },
      select: { stock: true, minimumStock: true },
    }),
  ]);

  const lowStockCount = activeProducts.filter((p) => p.stock <= p.minimumStock).length;

  return {
    today: {
      total: toNumber(todayAgg._sum.total),
      orders: todayAgg._count,
    },
    monthly: {
      total: toNumber(monthAgg._sum.total),
      orders: monthAgg._count,
    },
    lowStockCount,
    recentSales: recentSales.map((s) => ({
      id: s.id,
      invoiceNumber: s.invoiceNumber,
      total: toNumber(s.total),
      customerName: s.customerName,
      paymentMethod: s.paymentMethod,
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

export async function getSuperAdminDashboardData() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const monthStart = startOfMonth(now);
  const lastMonthStart = startOfMonth(subMonths(now, 1));

  const [
    storeCount,
    activeStoreCount,
    userCount,
    todayAgg,
    monthAgg,
    lastMonthAgg,
    topStoresGroup,
    recentActivity,
  ] = await Promise.all([
    prisma.store.count(),
    prisma.store.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { status: "ACTIVE", role: { not: "SUPER_ADMIN" } } }),
    prisma.sale.aggregate({
      where: { createdAt: { gte: todayStart } },
      _sum: { total: true, netProfit: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { createdAt: { gte: monthStart } },
      _sum: { total: true, netProfit: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { createdAt: { gte: lastMonthStart, lt: monthStart } },
      _sum: { total: true },
    }),
    prisma.sale.groupBy({
      by: ["storeId"],
      where: { createdAt: { gte: monthStart } },
      _sum: { total: true },
      orderBy: { _sum: { total: "desc" } },
      take: 5,
    }),
    prisma.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { user: { select: { name: true } }, store: { select: { name: true } } },
    }),
  ]);

  const topStoreDetails = await prisma.store.findMany({
    where: { id: { in: topStoresGroup.map((g) => g.storeId) } },
    select: { id: true, name: true },
  });

  const monthlyRevenue = toNumber(monthAgg._sum.total);
  const lastMonthRevenue = toNumber(lastMonthAgg._sum.total);

  function growth(current: number, previous: number) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  return {
    stores: { total: storeCount, active: activeStoreCount },
    users: { total: userCount },
    today: {
      revenue: toNumber(todayAgg._sum.total),
      profit: toNumber(todayAgg._sum.netProfit),
      orders: todayAgg._count,
    },
    monthly: {
      revenue: monthlyRevenue,
      profit: toNumber(monthAgg._sum.netProfit),
      revenueGrowth: growth(monthlyRevenue, lastMonthRevenue),
      orders: monthAgg._count,
    },
    topStores: topStoresGroup.map((g) => ({
      name: topStoreDetails.find((s) => s.id === g.storeId)?.name ?? "Unknown",
      revenue: toNumber(g._sum.total),
    })),
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      action: a.action,
      entity: a.entity,
      userName: a.user.name,
      storeName: a.store?.name ?? null,
      createdAt: a.createdAt.toISOString(),
      metadata: a.metadata as Record<string, unknown> | null,
    })),
  };
}
