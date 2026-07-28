import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DollarSign, TrendingUp, Boxes, Users, Receipt, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { StoreManagerSection } from "@/components/stores/store-manager-section";
import { getStoreById, getStoreStats } from "@/lib/queries/stores";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { STORE_STATUS_LABELS } from "@/lib/labels";

export const metadata: Metadata = { title: "Store Details" };

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const store = await getStoreById(id);
  if (!store) notFound();

  const stats = await getStoreStats(id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 gap-1.5">
          <Link href="/stores">
            <ArrowLeft className="size-3.5" />
            All stores
          </Link>
        </Button>
        <PageHeader
          title={store.name}
          description={`${store.code} · ${[store.city, store.country].filter(Boolean).join(", ") || "No location set"}`}
          actions={
            <StatusBadge variant={store.status === "ACTIVE" ? "success" : "neutral"}>
              {STORE_STATUS_LABELS[store.status]}
            </StatusBadge>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Monthly Revenue"
          value={formatCurrency(stats.monthlyRevenue, store.currency)}
          icon={<DollarSign />}
          tint="success"
        />
        <StatCard
          label="Monthly Profit"
          value={formatCurrency(stats.monthlyProfit, store.currency)}
          icon={<TrendingUp />}
          tint="success"
        />
        <StatCard
          label="Inventory Value"
          value={formatCurrency(stats.inventoryValue, store.currency)}
          icon={<Boxes />}
          tint="primary"
        />
        <StatCard label="Employees" value={String(stats.employeeCount)} icon={<Users />} tint="primary" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b pb-4">
            <CardTitle>Recent sales</CardTitle>
            <CardDescription>Last 8 sales at this store</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {stats.recentSales.length === 0 ? (
              <EmptyState icon={<Receipt />} title="No sales yet" className="border-none py-10" />
            ) : (
              <div className="flex flex-col divide-y">
                {stats.recentSales.map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium">{sale.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {sale.sellerName} · {formatDateTime(sale.createdAt)}
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatCurrency(sale.total, store.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <StoreManagerSection storeId={store.id} storeName={store.name} manager={stats.manager} />
      </div>
    </div>
  );
}
