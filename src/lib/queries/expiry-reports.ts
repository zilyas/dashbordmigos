import { prisma } from "@/lib/prisma";
import { round2, round3, variantLabelFromParts } from "@/lib/sale-math";
import { getTodayInTimezone, daysUntilExpiry as daysUntil, toDateKey } from "@/lib/timezone";
import { classifyExpiry, AT_RISK_BUCKETS, type ExpiryBucket } from "@/lib/expiry";

/** URL-facing filter. `undefined`/"all" = every at-risk bucket. */
export type ExpiryFilter = ExpiryBucket | "all" | undefined;

export type ExpiryReportRow = {
  batchId: string;
  batchCode: string;
  productId: string;
  productName: string;
  productSku: string;
  variantId: string | null;
  variantLabel: string | null;
  quantity: number;
  unit: string;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
  bucket: ExpiryBucket;
  status: "ACTIVE" | "DEPLETED" | "EXPIRED" | "ARCHIVED";
  receivedAt: string;
  effectiveUnitCost: number;
  stockValue: number;
};

export type ExpiryBucketSummary = { count: number; quantity: number; value: number };

export type ExpiryReport = {
  storeToday: string;
  generatedAt: string;
  filter: ExpiryFilter;
  summary: {
    buckets: Record<"expired" | "today" | "7" | "30" | "60", ExpiryBucketSummary>;
    totalAtRiskValue: number;
    missingDateCount: number;
  };
  rows: ExpiryReportRow[];
};

const emptyBucket = (): ExpiryBucketSummary => ({ count: 0, quantity: 0, value: 0 });

/** Normalize a raw searchParam into a valid filter. */
export function parseExpiryFilter(value: string | undefined): ExpiryFilter {
  const allowed = ["expired", "today", "7", "30", "60", "missing", "all"];
  return value && allowed.includes(value) ? (value as ExpiryFilter) : "all";
}

/**
 * Store-scoped expiry report over positive-stock, non-archived batches of
 * trackExpiry products. Classification uses expiryDate vs the store-local today
 * (never BatchStatus alone). Summary always covers every at-risk batch; `rows`
 * are narrowed to the requested window. Decimal → number happens here only.
 */
export async function getExpiryReport(storeId: string, filter: ExpiryFilter = "all"): Promise<ExpiryReport> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { timezone: true } });
  const storeToday = getTodayInTimezone(store.timezone);

  const batches = await prisma.productBatch.findMany({
    where: {
      storeId,
      stock: { gt: 0 },
      status: { not: "ARCHIVED" },
      product: { trackExpiry: true },
    },
    select: {
      id: true,
      batchCode: true,
      variantId: true,
      stock: true,
      costPrice: true,
      status: true,
      receivedAt: true,
      expiryDate: true,
      product: { select: { id: true, name: true, sku: true, unit: true, fabricationPrice: true } },
      variant: {
        select: {
          fabricationPrice: true,
          size: { select: { name: true } },
          color: { select: { name: true } },
        },
      },
    },
    orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
  });

  const summary = {
    buckets: {
      expired: emptyBucket(),
      today: emptyBucket(),
      "7": emptyBucket(),
      "30": emptyBucket(),
      "60": emptyBucket(),
    } as Record<"expired" | "today" | "7" | "30" | "60", ExpiryBucketSummary>,
    totalAtRiskValue: 0,
    missingDateCount: 0,
  };

  const allRows: ExpiryReportRow[] = batches.map((b) => {
    const quantity = round3(Number(b.stock));
    const days = b.expiryDate ? daysUntil(b.expiryDate, storeToday) : null;
    const bucket = classifyExpiry(days);
    // Effective unit cost: batch → variant → product fallback.
    const effectiveUnitCost =
      b.costPrice != null
        ? Number(b.costPrice)
        : b.variant?.fabricationPrice != null
          ? Number(b.variant.fabricationPrice)
          : Number(b.product.fabricationPrice);
    const stockValue = round2(quantity * effectiveUnitCost);

    if (bucket === "missing") summary.missingDateCount += 1;
    if (bucket in summary.buckets) {
      const s = summary.buckets[bucket as keyof typeof summary.buckets];
      s.count += 1;
      s.quantity = round3(s.quantity + quantity);
      s.value = round2(s.value + stockValue);
      summary.totalAtRiskValue = round2(summary.totalAtRiskValue + stockValue);
    }

    return {
      batchId: b.id,
      batchCode: b.batchCode,
      productId: b.product.id,
      productName: b.product.name,
      productSku: b.product.sku,
      variantId: b.variantId,
      variantLabel: b.variant ? variantLabelFromParts([b.variant.size?.name, b.variant.color?.name]) || null : null,
      quantity,
      unit: b.product.unit ?? "piece",
      expiryDate: b.expiryDate ? toDateKey(b.expiryDate) : null,
      daysUntilExpiry: days,
      bucket,
      status: b.status,
      receivedAt: b.receivedAt.toISOString(),
      effectiveUnitCost: round2(effectiveUnitCost),
      stockValue,
    };
  });

  const rows = allRows.filter((r) => {
    if (filter === "all" || filter === undefined) return AT_RISK_BUCKETS.includes(r.bucket);
    if (filter === "missing") return r.bucket === "missing";
    return r.bucket === filter;
  });

  return { storeToday, generatedAt: new Date().toISOString(), filter, summary, rows };
}
