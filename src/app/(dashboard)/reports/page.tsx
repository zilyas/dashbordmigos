import type { Metadata } from "next";
import Link from "next/link";
import { Download, DollarSign, TrendingUp, Receipt, ShoppingCart, BarChart3, CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { EmptyState } from "@/components/shared/empty-state";
import { getReportData, REPORT_PERIODS, type ReportPeriod } from "@/lib/queries/reports";
import { getStoreSettings } from "@/lib/queries/settings";
import { getSessionContext } from "@/lib/store-context";
import { getStoreFeatures } from "@/lib/features";
import { DEFAULT_CURRENCY, formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  daily: "Today",
  weekly: "This Week",
  monthly: "This Month",
  yearly: "This Year",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: periodParam } = await searchParams;
  const period: ReportPeriod = (REPORT_PERIODS as readonly string[]).includes(periodParam ?? "")
    ? (periodParam as ReportPeriod)
    : "monthly";

  const context = await getSessionContext();
  const isSuperAdmin = context!.role === "SUPER_ADMIN";
  const storeId = isSuperAdmin ? null : context!.storeId;

  const [data, settings, features] = await Promise.all([
    getReportData(period, storeId),
    storeId ? getStoreSettings(storeId) : Promise.resolve(null),
    storeId ? getStoreFeatures(storeId) : Promise.resolve(null),
  ]);
  const currency = settings?.currency ?? DEFAULT_CURRENCY;
  const showExpiryReport = !isSuperAdmin && !!features?.expiry_batch_enabled;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description={
          isSuperAdmin
            ? "Revenue and profit breakdown across every store."
            : "Revenue and profit breakdown for your store."
        }
        actions={
          <div className="flex items-center gap-2">
            {showExpiryReport && (
              <Button asChild variant="outline" className="gap-1.5">
                <Link href="/reports/expiry">
                  <CalendarClock className="size-4" />
                  Expiry report
                </Link>
              </Button>
            )}
            <Button asChild variant="outline" className="gap-1.5">
              <a href={`/api/reports/export?period=${period}`} download>
                <Download className="size-4" />
                Export CSV
              </a>
            </Button>
          </div>
        }
      />

      <div className="flex w-fit items-center gap-1 rounded-lg border bg-muted/40 p-1">
        {REPORT_PERIODS.map((p) => (
          <Link
            key={p}
            href={`/reports?period=${p}`}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              p === period
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {PERIOD_LABELS[p]}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Revenue" value={formatCurrency(data.summary.revenue, currency)} icon={<DollarSign />} tint="success" />
        <StatCard label="Profit" value={formatCurrency(data.summary.profit, currency)} icon={<TrendingUp />} tint="success" />
        <StatCard label="Orders" value={formatNumber(data.summary.orders)} icon={<Receipt />} tint="primary" />
        <StatCard label="Average Order" value={formatCurrency(data.summary.averageOrder, currency)} icon={<ShoppingCart />} tint="primary" />
      </div>

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>Trend</CardTitle>
          <CardDescription>Revenue and profit for {PERIOD_LABELS[period].toLowerCase()}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {data.breakdown.every((b) => b.revenue === 0) ? (
            <EmptyState icon={<BarChart3 />} title="No sales in this period" className="h-64 border-none" />
          ) : (
            <RevenueChart
              data={data.breakdown.map((b) => ({ date: b.label, revenue: b.revenue, profit: b.profit }))}
              currency={currency}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.breakdown.map((b) => (
                <TableRow key={b.label}>
                  <TableCell className="font-medium">{b.label}</TableCell>
                  <TableCell className="tabular-nums">{b.orders}</TableCell>
                  <TableCell className="tabular-nums">{formatCurrency(b.revenue, currency)}</TableCell>
                  <TableCell className="tabular-nums text-success">{formatCurrency(b.profit, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
