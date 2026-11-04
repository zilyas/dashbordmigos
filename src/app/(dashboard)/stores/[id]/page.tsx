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
import { StoreDangerZone } from "@/components/stores/store-danger-zone";
import { getTranslations } from "next-intl/server";
import { getStoreById, getStoreStats } from "@/lib/queries/stores";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { storeStatusLabel } from "@/lib/labels";
import { getSessionContext } from "@/lib/store-context";
import { toAppLocale } from "@/i18n/messages";

export const metadata: Metadata = { title: "Store Details" };

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const store = await getStoreById(id);
  if (!store) notFound();

  const context = await getSessionContext();
  const locale = toAppLocale(context?.locale);
  const tLabels = await getTranslations({ locale, namespace: "labels" });
  const t = await getTranslations({ locale, namespace: "storeDetail" });
  const stats = await getStoreStats(id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 gap-1.5">
          <Link href="/stores">
            <ArrowLeft className="size-3.5" />
            {t("allStores")}
          </Link>
        </Button>
        <PageHeader
          title={store.name}
          description={`${store.code} · ${[store.city, store.country].filter(Boolean).join(", ") || t("noLocationSet")}`}
          actions={
            <StatusBadge variant={store.status === "ACTIVE" ? "success" : "neutral"}>
              {storeStatusLabel(tLabels, store.status)}
            </StatusBadge>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("stats.monthlyRevenue")}
          value={formatCurrency(stats.monthlyRevenue, store.currency)}
          icon={<DollarSign />}
          tint="success"
        />
        <StatCard
          label={t("stats.monthlyProfit")}
          value={formatCurrency(stats.monthlyProfit, store.currency)}
          icon={<TrendingUp />}
          tint="success"
        />
        <StatCard
          label={t("stats.inventoryValue")}
          value={formatCurrency(stats.inventoryValue, store.currency)}
          icon={<Boxes />}
          tint="primary"
        />
        <StatCard label={t("stats.employees")} value={String(stats.employeeCount)} icon={<Users />} tint="primary" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b pb-4">
            <CardTitle>{t("recentSales.title")}</CardTitle>
            <CardDescription>{t("recentSales.description")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {stats.recentSales.length === 0 ? (
              <EmptyState icon={<Receipt />} title={t("recentSales.emptyTitle")} className="border-none py-10" />
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

      <StoreDangerZone storeId={store.id} storeName={store.name} />
    </div>
  );
}
