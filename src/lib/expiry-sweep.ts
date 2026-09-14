import { prisma } from "@/lib/prisma";
import { parseFeatures } from "@/lib/features";
import { getTodayInTimezone, daysUntilExpiry as daysUntil, toDateKey } from "@/lib/timezone";
import { notificationThresholdFor, expiryDedupeKey, THRESHOLD_SEVERITY, type NotificationThreshold } from "@/lib/expiry";
import { round3, variantLabelFromParts } from "@/lib/sale-math";

/**
 * Server-only expiry sweep (Phase 4c2). Never import from client code.
 *
 * Idempotent status hygiene + deduplicated Manager notifications. It is an
 * optimization/UI aid — sales and reports already classify from expiryDate +
 * store-local today, so correctness never depends on this having run. The sweep
 * never touches stock, aggregates, allocations, or archives.
 */

export type ExpirySweepSummary = {
  storesProcessed: number;
  batchesExamined: number;
  statusesUpdated: number;
  notificationsCreated: number;
  duplicatesSkipped: number;
  integrityWarnings: number;
};

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

function notificationText(args: {
  threshold: NotificationThreshold;
  productName: string;
  variantLabel: string | null;
  batchCode: string;
  quantity: number;
  unit: string;
  expiryKey: string;
}) {
  const who = args.variantLabel ? `${args.productName} (${args.variantLabel})` : args.productName;
  const title = THRESHOLD_SEVERITY[args.threshold];
  const verb =
    args.threshold === "expired"
      ? `expired on ${args.expiryKey}`
      : args.threshold === "today"
        ? `expires today (${args.expiryKey})`
        : `expires on ${args.expiryKey}`;
  // No cost is exposed in notification text.
  const message = `${who} — batch ${args.batchCode}: ${fmtQty(args.quantity)} ${args.unit} ${verb}.`;
  return { title, message };
}

/**
 * Process one store: refresh EXPIRED/ACTIVE statuses (no stock change) and create
 * idempotent notifications for active Managers. Returns per-store counts.
 */
async function sweepStore(store: { id: string; timezone: string }): Promise<ExpirySweepSummary> {
  const summary: ExpirySweepSummary = {
    storesProcessed: 1,
    batchesExamined: 0,
    statusesUpdated: 0,
    notificationsCreated: 0,
    duplicatesSkipped: 0,
    integrityWarnings: 0,
  };
  const storeToday = getTodayInTimezone(store.timezone);
  const cutoff = new Date(storeToday + "T00:00:00.000Z");

  // ── Status hygiene (never alters stock) ──────────────────────────────────
  // ACTIVE positive-stock past its date → EXPIRED.
  const expired = await prisma.productBatch.updateMany({
    where: {
      storeId: store.id,
      status: "ACTIVE",
      stock: { gt: 0 },
      expiryDate: { not: null, lt: cutoff },
      product: { trackExpiry: true },
    },
    data: { status: "EXPIRED" },
  });
  // EXPIRED positive-stock whose date was corrected to today/future → ACTIVE.
  const revived = await prisma.productBatch.updateMany({
    where: {
      storeId: store.id,
      status: "EXPIRED",
      stock: { gt: 0 },
      expiryDate: { not: null, gte: cutoff },
    },
    data: { status: "ACTIVE" },
  });
  summary.statusesUpdated = expired.count + revived.count;

  // ── Notifications ────────────────────────────────────────────────────────
  const managers = await prisma.user.findMany({
    where: { storeId: store.id, role: "MANAGER", status: "ACTIVE" },
    select: { id: true },
  });

  const batches = await prisma.productBatch.findMany({
    where: {
      storeId: store.id,
      stock: { gt: 0 },
      status: { not: "ARCHIVED" },
      product: { trackExpiry: true },
    },
    select: {
      id: true,
      batchCode: true,
      stock: true,
      expiryDate: true,
      product: { select: { name: true, unit: true } },
      variant: { select: { size: { select: { name: true } }, color: { select: { name: true } } } },
    },
  });
  summary.batchesExamined = batches.length;

  if (managers.length > 0) {
    const rows: {
      storeId: string;
      userId: string;
      type: "EXPIRING_STOCK" | "EXPIRED_STOCK";
      title: string;
      message: string;
      dedupeKey: string;
    }[] = [];

    for (const b of batches) {
      if (b.expiryDate == null) {
        summary.integrityWarnings += 1; // trackExpiry batch with stock but no date
        continue;
      }
      const days = daysUntil(b.expiryDate, storeToday);
      const threshold = notificationThresholdFor(days);
      if (!threshold) continue; // outside 30 days → no alert
      const expiryKey = toDateKey(b.expiryDate);
      const quantity = round3(Number(b.stock));
      const variantLabel = b.variant
        ? variantLabelFromParts([b.variant.size?.name, b.variant.color?.name]) || null
        : null;
      const { title, message } = notificationText({
        threshold,
        productName: b.product.name,
        variantLabel,
        batchCode: b.batchCode,
        quantity,
        unit: b.product.unit ?? "piece",
        expiryKey,
      });
      const dedupeKey = expiryDedupeKey(b.id, expiryKey, threshold);
      const type = threshold === "expired" ? "EXPIRED_STOCK" : "EXPIRING_STOCK";
      for (const m of managers) {
        rows.push({ storeId: store.id, userId: m.id, type, title, message, dedupeKey });
      }
    }

    if (rows.length > 0) {
      // ON CONFLICT DO NOTHING via the partial unique index → safe across
      // repeated and concurrent sweeps.
      const created = await prisma.notification.createMany({ data: rows, skipDuplicates: true });
      summary.notificationsCreated = created.count;
      summary.duplicatesSkipped = rows.length - created.count;
    }
  }

  return summary;
}

function mergeSummaries(a: ExpirySweepSummary, b: ExpirySweepSummary): ExpirySweepSummary {
  return {
    storesProcessed: a.storesProcessed + b.storesProcessed,
    batchesExamined: a.batchesExamined + b.batchesExamined,
    statusesUpdated: a.statusesUpdated + b.statusesUpdated,
    notificationsCreated: a.notificationsCreated + b.notificationsCreated,
    duplicatesSkipped: a.duplicatesSkipped + b.duplicatesSkipped,
    integrityWarnings: a.integrityWarnings + b.integrityWarnings,
  };
}

const EMPTY: ExpirySweepSummary = {
  storesProcessed: 0,
  batchesExamined: 0,
  statusesUpdated: 0,
  notificationsCreated: 0,
  duplicatesSkipped: 0,
  integrityWarnings: 0,
};

/**
 * Run the sweep. With `storeId` it processes exactly that store (manual refresh);
 * otherwise every store with `expiry_batch_enabled` (the daily cron). The store
 * feature flag and timezone come only from the store record.
 */
export async function runExpirySweep(opts?: { storeId?: string }): Promise<ExpirySweepSummary> {
  const stores = await prisma.store.findMany({
    where: { status: "ACTIVE", ...(opts?.storeId ? { id: opts.storeId } : {}) },
    select: { id: true, timezone: true, features: true },
  });
  let summary = EMPTY;
  for (const s of stores) {
    if (!parseFeatures(s.features).expiry_batch_enabled) continue;
    summary = mergeSummaries(summary, await sweepStore({ id: s.id, timezone: s.timezone }));
  }
  return summary;
}
