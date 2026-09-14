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
import { BUCKET_LABEL, type ExpiryBucket } from "@/lib/expiry";
import { DEFAULT_CURRENCY, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Expiry report" };

const FILTERS: { key: ExpiryFilter; label: string }[] = [
  { key: "all", label: "All at risk" },
  { key: "expired", label: "Expired" },
  { key: "today", label: "Today" },
  { key: "7", label: "≤7 days" },
  { key: "30", label: "≤30 days" },
  { key: "60", label: "≤60 days" },
  { key: "missing", label: "Missing date" },
];

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
  const storeId = requireStoreId(context!);
  const features = await getStoreFeatures(storeId);

  if (!features.expiry_batch_enabled) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Expiry report" description="Batch & expiry inventory." />
        <EmptyState
          icon={<CalendarClock />}
          title="Batch & expiry tracking is off"
          description="Enable it in Settings, then turn on expiry tracking per product to see this report."
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
        title="Expiry report"
        description={`At-risk batch inventory · store-local today ${report.storeToday}`}
        actions={
          <div className="flex items-center gap-2">
            <ExpiryRefreshButton />
            <Button asChild variant="outline" className="gap-1.5">
              <a href={`/api/reports/expiry/export?window=${filter}`} download>
                <Download className="size-4" /> Export CSV
              </a>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Expired" value={String(s.buckets.expired.count)} icon={<PackageX />} tint="destructive" />
        <StatCard label="Today" value={String(s.buckets.today.count)} icon={<CalendarClock />} tint="warning" />
        <StatCard label="≤7 days" value={String(s.buckets["7"].count)} icon={<CalendarClock />} tint="warning" />
        <StatCard label="≤30 days" value={String(s.buckets["30"].count)} icon={<CalendarClock />} tint="primary" />
        <StatCard label="At-risk value" value={formatCurrency(s.totalAtRiskValue, currency)} icon={<AlertTriangle />} tint="primary" />
      </div>

      {s.missingDateCount > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="size-4" />
          {s.missingDateCount} batch(es) have stock but no expiry date — fix them from the product page.
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
          <CardTitle>Batches</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {!hasAnything ? (
            <EmptyState
              icon={<CalendarClock />}
              title="No expiry-tracked stock yet"
              description="Turn on expiry tracking for a product and receive dated batches to populate this report."
              className="h-48 border-none"
            />
          ) : report.rows.length === 0 ? (
            <EmptyState icon={<CalendarClock />} title="Nothing in this window" className="h-40 border-none" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
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
                      <TableCell>{r.status}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/products/${r.productId}/edit`} className="text-sm text-primary hover:underline">
                          Edit
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
