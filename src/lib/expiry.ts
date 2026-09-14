/**
 * Pure expiry-report classification + notification logic (Phase 4c2).
 *
 * No Prisma, no I/O, no timezone maths (callers pass a `daysUntilExpiry` already
 * computed against the store-local today via `src/lib/timezone.ts`). This keeps
 * bucketing and notification thresholds deterministic and unit-testable, and
 * shared between the report page, the CSV export, and the sweep.
 */

/** Report buckets. Every stock-bearing batch lands in exactly ONE. */
export type ExpiryBucket = "expired" | "today" | "7" | "30" | "60" | "later" | "missing";

/** All buckets considered "at risk" (used by the "all at-risk" report filter). */
export const AT_RISK_BUCKETS: ExpiryBucket[] = ["expired", "today", "7", "30", "60"];

/**
 * Classify a batch by whole days until expiry (negative = past). `null` means the
 * batch has no expiry date — an integrity warning for a trackExpiry product.
 * Windows (store-local): expired <0 · today 0 · 1–7 · 8–30 · 31–60 · later >60.
 */
export function classifyExpiry(daysUntilExpiry: number | null): ExpiryBucket {
  if (daysUntilExpiry === null) return "missing";
  if (daysUntilExpiry < 0) return "expired";
  if (daysUntilExpiry === 0) return "today";
  if (daysUntilExpiry <= 7) return "7";
  if (daysUntilExpiry <= 30) return "30";
  if (daysUntilExpiry <= 60) return "60";
  return "later";
}

/** Human label per bucket (UI + CSV). */
export const BUCKET_LABEL: Record<ExpiryBucket, string> = {
  expired: "Expired",
  today: "Expires today",
  "7": "≤7 days",
  "30": "≤30 days",
  "60": "≤60 days",
  later: "Later",
  missing: "Missing date",
};

/** Notification thresholds, most-urgent first. No alert beyond 30 days. */
export type NotificationThreshold = "expired" | "today" | "7" | "30";

/**
 * The single most-urgent notification threshold for a batch given its whole days
 * until expiry, or null when no alert is due (>30 days, or missing date). A late
 * sweep therefore fires only the current threshold, never every one the batch has
 * passed. Priority: expired > today > 7 > 30.
 */
export function notificationThresholdFor(daysUntilExpiry: number | null): NotificationThreshold | null {
  if (daysUntilExpiry === null) return null;
  if (daysUntilExpiry < 0) return "expired";
  if (daysUntilExpiry === 0) return "today";
  if (daysUntilExpiry <= 7) return "7";
  if (daysUntilExpiry <= 30) return "30";
  return null;
}

/**
 * Stable idempotency key for one alert. Includes the expiry date so that
 * CORRECTING a batch's date produces a new key (a fresh, legitimate alert), while
 * a repeated sweep at the same date+threshold collides and is skipped.
 * e.g. `expiry:<batchId>:2026-06-30:7`
 */
export function expiryDedupeKey(
  batchId: string,
  expiryKey: string,
  threshold: NotificationThreshold
): string {
  return `expiry:${batchId}:${expiryKey}:${threshold}`;
}

/** Severity wording per threshold for notification titles. */
export const THRESHOLD_SEVERITY: Record<NotificationThreshold, string> = {
  expired: "Expired stock",
  today: "Stock expires today",
  "7": "Stock expiring within 7 days",
  "30": "Stock expiring within 30 days",
};
