import type { Metadata } from "next";
import Link from "next/link";
import {
  DollarSign,
  TrendingUp,
  ShoppingCart,
  Boxes,
  AlertTriangle,
  Trophy,
  Receipt,
  CalendarDays,
  ArrowRight,
  Store,
  Users,
  Trophy as TrophyIcon,
} from "lucide-react";
import { getSessionContext } from "@/lib/store-context";
import {
  getManagerDashboardData,
  getSellerDashboardData,
  getSuperAdminDashboardData,
} from "@/lib/queries/dashboard";
import { getStoreSettings } from "@/lib/queries/settings";
import { getUnreadAnnouncementsForUser } from "@/lib/queries/announcements";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { CategoryChart } from "@/components/dashboard/category-chart";
import { BestSellersChart } from "@/components/dashboard/best-sellers-chart";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { UnreadAnnouncementsCard } from "@/components/dashboard/unread-announcements-card";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const context = await getSessionContext();
  const role = context!.role;

  const unreadAnnouncementRows = await getUnreadAnnouncementsForUser(context!.userId, 3);
  const unreadAnnouncements = unreadAnnouncementRows.map((r) => ({
    id: r.announcement.id,
    title: r.announcement.title,
    scope: r.announcement.scope,
    createdAt: r.announcement.createdAt,
    createdBy: { name: r.announcement.createdBy.name },
  }));

  if (role === "SUPER_ADMIN") {
    const data = await getSuperAdminDashboardData();
    const maxStoreRevenue = Math.max(1, ...data.topStores.map((s) => s.revenue));

    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Platform Overview"
          description="Revenue, profit and activity across every store."
          actions={
            <Button asChild>
              <Link href="/stores">Manage Stores</Link>
            </Button>
          }
        />

        <UnreadAnnouncementsCard announcements={unreadAnnouncements} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Active Stores" value={`${data.stores.active} / ${data.stores.total}`} icon={<Store />} tint="primary" />
          <StatCard label="Total Users" value={formatNumber(data.users.total)} icon={<Users />} tint="primary" />
          <StatCard label="Today's Revenue" value={formatCurrency(data.today.revenue, "USD")} icon={<DollarSign />} tint="success" />
          <StatCard label="Today's Orders" value={formatNumber(data.today.orders)} icon={<Receipt />} tint="primary" />
          <StatCard
            label="Monthly Revenue"
            value={formatCurrency(data.monthly.revenue, "USD")}
            icon={<TrendingUp />}
            tint="primary"
            trend={{ value: data.monthly.revenueGrowth, label: "vs last month" }}
          />
          <StatCard label="Monthly Profit" value={formatCurrency(data.monthly.profit, "USD")} icon={<DollarSign />} tint="success" />
          <StatCard label="Monthly Orders" value={formatNumber(data.monthly.orders)} icon={<ShoppingCart />} tint="primary" />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="border-b pb-4">
              <CardTitle>Top stores this month</CardTitle>
              <CardDescription>By revenue</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              {data.topStores.length === 0 ? (
                <EmptyState icon={<TrophyIcon />} title="No sales yet" className="border-none py-10" />
              ) : (
                <div className="flex flex-col gap-4">
                  {data.topStores.map((store, i) => (
                    <div key={store.name + i} className="flex items-center gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                        {i + 1}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{store.name}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {formatCurrency(store.revenue, "USD")}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${(store.revenue / maxStoreRevenue) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b pb-4">
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Latest actions across the platform</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <ActivityFeed items={data.recentActivity} />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const storeId = context!.storeId!;
  const settings = await getStoreSettings(storeId);
  const currency = settings.currency;

  if (role === "SELLER") {
    const data = await getSellerDashboardData(context!.userId, storeId);
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Welcome back"
          description="Here's how your sales are looking."
          actions={
            <Button asChild>
              <Link href="/sales/new">New Sale</Link>
            </Button>
          }
        />

        <UnreadAnnouncementsCard announcements={unreadAnnouncements} />

        {data.lowStockCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-warning-foreground" />
            <span>
              {data.lowStockCount} product{data.lowStockCount === 1 ? "" : "s"} running low on
              stock store-wide.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Today's Sales" value={formatCurrency(data.today.total, currency)} icon={<DollarSign />} tint="success" />
          <StatCard label="Today's Orders" value={formatNumber(data.today.orders)} icon={<Receipt />} tint="primary" />
          <StatCard label="This Month's Sales" value={formatCurrency(data.monthly.total, currency)} icon={<TrendingUp />} tint="success" />
          <StatCard label="This Month's Orders" value={formatNumber(data.monthly.orders)} icon={<CalendarDays />} tint="primary" />
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between border-b pb-4">
            <div>
              <CardTitle>My recent sales</CardTitle>
              <CardDescription>Your last 8 completed sales</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link href="/sales">
                View all
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-4">
            {data.recentSales.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No sales yet — start your first one from the sidebar.
              </p>
            ) : (
              <div className="flex flex-col divide-y">
                {data.recentSales.map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium">{sale.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {sale.customerName ?? "Walk-in customer"} · {formatDateTime(sale.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge variant="neutral">{PAYMENT_METHOD_LABELS[sale.paymentMethod]}</StatusBadge>
                      <span className="text-sm font-semibold tabular-nums">
                        {formatCurrency(sale.total, currency)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const data = await getManagerDashboardData(storeId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description={`Overview of ${settings.storeName}`}
        actions={
          <Button asChild>
            <Link href="/sales/new">New Sale</Link>
          </Button>
        }
      />

      <UnreadAnnouncementsCard announcements={unreadAnnouncements} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Today's Revenue" value={formatCurrency(data.today.revenue, currency)} icon={<DollarSign />} tint="success" />
        <StatCard label="Today's Profit" value={formatCurrency(data.today.profit, currency)} icon={<TrendingUp />} tint="success" />
        <StatCard label="Today's Orders" value={formatNumber(data.today.orders)} icon={<Receipt />} tint="primary" />
        <StatCard
          label="Monthly Revenue"
          value={formatCurrency(data.monthly.revenue, currency)}
          icon={<DollarSign />}
          tint="primary"
          trend={{ value: data.monthly.revenueGrowth, label: "vs last month" }}
        />
        <StatCard
          label="Monthly Profit"
          value={formatCurrency(data.monthly.profit, currency)}
          icon={<TrendingUp />}
          tint="primary"
          trend={{ value: data.monthly.profitGrowth, label: "vs last month" }}
        />
        <StatCard label="Units In Stock" value={formatNumber(data.stock.unitsInStock)} icon={<Boxes />} tint="primary" />
        <StatCard
          label="Low Stock Items"
          value={formatNumber(data.stock.lowStockCount)}
          icon={<AlertTriangle />}
          tint={data.stock.lowStockCount > 0 ? "warning" : "success"}
        />
        <StatCard label="Top Seller" value={data.topSeller} icon={<Trophy />} tint="primary" />
        <StatCard label="Average Order" value={formatCurrency(data.monthly.averageOrder, currency)} icon={<ShoppingCart />} tint="primary" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b pb-4">
            <CardTitle>Revenue & profit</CardTitle>
            <CardDescription>Last 14 days</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <RevenueChart data={data.revenueTrend} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle>Sales by category</CardTitle>
            <CardDescription>Last 30 days</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <CategoryChart data={data.salesByCategory} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b pb-4">
            <CardTitle>Best selling products</CardTitle>
            <CardDescription>By units sold, last 30 days</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <BestSellersChart data={data.bestSellers} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Latest actions across the store</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <ActivityFeed items={data.recentActivity} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
