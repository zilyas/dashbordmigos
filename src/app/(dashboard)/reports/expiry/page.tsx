import type { Metadata } from "next";
import Link from "next/link";
import { Download, CalendarClock, AlertTriangle, PackageX } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ExpiryRefreshButton } from "@/components/reports/expiry-refresh-button";
import { getExpiryReport, parseExpiryFilter, type ExpiryFilter } from "@/lib/queries/expiry-reports";
import { getStoreSettings } from "@/lib/queries/settings";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { getStoreFeatures } from "@/lib/features";
import { type ExpiryBucket } from "@/lib/expiry";
import { batchStatusLabel } from "@/lib/labels";
import { DEFAULT_CURRENCY, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getTranslations } from "next-intl/server";
import { toAppLocale } from "@/i18n/messages";

export const metadata: Metadata = { title: "Expiry report" };

const BUCKET_CLASS: Record<ExpiryBucket, string> = {
  expired: "text-red-700 dark:text-red-400",
  today: "text-amber-700 dark:text-amber-400",
  "7": "text-amber-700 dark:text-amber-400",
  "30": "text-muted-foreground",
  "60": "text-muted-foreground",
  later: "text-muted-foreground",
  missing: "text-red-700 dark:text-red-400",
};

export default async function ExpiryReportPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const context = await getSessionContext();
  const locale = toAppLocale(context!.locale);
  const t = await getTranslations({ locale, namespace: "reports.expiry" });
  const tLabels = await getTranslations({ locale, namespace: "labels" });

  const FILTERS: { key: ExpiryFilter; label: string }[] = [
    { key: "all", label: t("filters.all") },
    { key: "expired", label: t("filters.expired") },
    { key: "today", label: t("filters.today") },
    { key: "7", label: t("filters.within7") },
    { key: "30", label: t("filters.within30") },
    { key: "60", label: t("filters.within60") },
    { key: "missing", label: t("filters.missingDate") },
  ];

  const BUCKET_LABEL: Record<ExpiryBucket, string> = {
    expired: t("buckets.expired"),
    today: t("buckets.today"),
    "7": t("buckets.7"),
    "30": t("buckets.30"),
    "60": t("buckets.60"),
    later: t("buckets.later"),
    missing: t("buckets.missing"),
  };

  const storeId = requireStoreId(context!);
  const features = await getStoreFeatures(storeId);

  if (!features.expiry_batch_enabled) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} description={t("featureOffPageDescription")} />
        <EmptyState
          icon={<CalendarClock />}
          title={t("featureOffTitle")}
          description={t("featureOffDescription")}
        />
      </div>
    );
  }

  const { window } = await searchParams;
  const filter = parseExpiryFilter(window);
  const [report, settings] = await Promise.all([getExpiryReport(storeId, filter), getStoreSettings(storeId)]);
  const currency = settings?.currency ?? DEFAULT_CURRENCY;
  const s = report.summary;

  const hasAnything =
    report.rows.length > 0 || s.totalAtRiskValue > 0 || s.missingDateCount > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description", { today: report.storeToday })}
        actions={
          <div className="flex items-center gap-2">
            <ExpiryRefreshButton />
            <Button asChild variant="outline" className="gap-1.5">
              <a href={`/api/reports/expiry/export?window=${filter}`} download>
                <Download className="size-4" /> {t("exportCsv")}
              </a>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label={t("stats.expired")} value={String(s.buckets.expired.count)} icon={<PackageX />} tint="destructive" />
        <StatCard label={t("stats.today")} value={String(s.buckets.today.count)} icon={<CalendarClock />} tint="warning" />
        <StatCard label={t("stats.within7")} value={String(s.buckets["7"].count)} icon={<CalendarClock />} tint="warning" />
        <StatCard label={t("stats.within30")} value={String(s.buckets["30"].count)} icon={<CalendarClock />} tint="primary" />
        <StatCard label={t("stats.atRiskValue")} value={formatCurrency(s.totalAtRiskValue, currency)} icon={<AlertTriangle />} tint="primary" />
      </div>

      {s.missingDateCount > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="size-4" />
          {t("missingDateWarning", { count: s.missingDateCount })}
        </div>
      )}

      <div className="flex w-fit flex-wrap items-center gap-1 rounded-lg border bg-muted/40 p-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/reports/expiry?window=${f.key}`}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              f.key === filter ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{t("batchesCardTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {!hasAnything ? (
            <EmptyState
              icon={<CalendarClock />}
              title={t("emptyNoStockTitle")}
              description={t("emptyNoStockDescription")}
              className="h-48 border-none"
            />
          ) : report.rows.length === 0 ? (
            <EmptyState icon={<CalendarClock />} title={t("emptyNothingInWindow")} className="h-40 border-none" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("table.product")}</TableHead>
                    <TableHead>{t("table.batch")}</TableHead>
                    <TableHead>{t("table.expiry")}</TableHead>
                    <TableHead>{t("table.days")}</TableHead>
                    <TableHead>{t("table.qty")}</TableHead>
                    <TableHead>{t("table.value")}</TableHead>
                    <TableHead>{t("table.status")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((r) => (
                    <TableRow key={r.batchId}>
                      <TableCell className="font-medium">
                        {r.productName}
                        {r.variantLabel && <span className="text-muted-foreground"> · {r.variantLabel}</span>}
                        <span className="block text-xs text-muted-foreground">{r.productSku}</span>
                      </TableCell>
                      <TableCell>{r.batchCode}</TableCell>
                      <TableCell className="tabular-nums">
                        {r.expiryDate ?? "—"}
                        <span className={cn("block text-xs", BUCKET_CLASS[r.bucket])}>{BUCKET_LABEL[r.bucket]}</span>
                      </TableCell>
                      <TableCell className="tabular-nums">{r.daysUntilExpiry ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{r.quantity} {r.unit}</TableCell>
                      <TableCell className="tabular-nums">{formatCurrency(r.stockValue, currency)}</TableCell>
                      <TableCell>{batchStatusLabel(tLabels, r.status)}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/products/${r.productId}/edit`} className="text-sm text-primary hover:underline">
                          {t("edit")}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
