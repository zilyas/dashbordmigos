import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  eachDayOfInterval,
  eachMonthOfInterval,
  format,
} from "date-fns";
import { prisma } from "@/lib/prisma";

export const REPORT_PERIODS = ["daily", "weekly", "monthly", "yearly"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

function getRange(period: ReportPeriod, now = new Date()) {
  switch (period) {
    case "daily":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "weekly":
      return { start: startOfWeek(now), end: endOfWeek(now) };
    case "monthly":
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case "yearly":
      return { start: startOfYear(now), end: endOfYear(now) };
  }
}

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

/** `storeId: null` (Super Admin only) aggregates across every store. */
export async function getReportData(period: ReportPeriod, storeId: string | null) {
  const now = new Date();
  const { start, end } = getRange(period, now);

  const sales = await prisma.sale.findMany({
    where: { createdAt: { gte: start, lte: end }, ...(storeId ? { storeId } : {}) },
    select: { createdAt: true, total: true, netProfit: true },
    orderBy: { createdAt: "asc" },
  });

  const summary = sales.reduce(
    (acc, s) => {
      acc.revenue += toNumber(s.total);
      acc.profit += toNumber(s.netProfit);
      acc.orders += 1;
      return acc;
    },
    { revenue: 0, profit: 0, orders: 0 }
  );

  const buckets =
    period === "yearly"
      ? eachMonthOfInterval({ start, end }).map((d) => ({ key: format(d, "yyyy-MM"), label: format(d, "MMM") }))
      : eachDayOfInterval({ start, end }).map((d) => ({ key: format(d, "yyyy-MM-dd"), label: format(d, "MMM d") }));

  const bucketMap = new Map(buckets.map((b) => [b.key, { label: b.label, revenue: 0, profit: 0, orders: 0 }]));

  for (const sale of sales) {
    const key = period === "yearly" ? format(sale.createdAt, "yyyy-MM") : format(sale.createdAt, "yyyy-MM-dd");
    const bucket = bucketMap.get(key);
    if (bucket) {
      bucket.revenue += toNumber(sale.total);
      bucket.profit += toNumber(sale.netProfit);
      bucket.orders += 1;
    }
  }

  const breakdown = Array.from(bucketMap.values()).map((b) => ({
    ...b,
    revenue: Math.round(b.revenue * 100) / 100,
    profit: Math.round(b.profit * 100) / 100,
  }));

  return {
    period,
    range: { start: start.toISOString(), end: end.toISOString() },
    summary: {
      revenue: Math.round(summary.revenue * 100) / 100,
      profit: Math.round(summary.profit * 100) / 100,
      orders: summary.orders,
      averageOrder: summary.orders > 0 ? Math.round((summary.revenue / summary.orders) * 100) / 100 : 0,
    },
    breakdown,
  };
}

export type ReportData = Awaited<ReturnType<typeof getReportData>>;
