/**
 * Pure helpers for Phase 4 expiry/batch tracking (foundation — DORMANT).
 *
 * No Prisma, no auth, no I/O — deliberately client-safe and side-effect free so
 * it can be unit-tested in isolation and reused by future server actions
 * (receiving, FEFO sale allocation, batch-aware returns) without dragging
 * server-only code across boundaries. These functions describe *what* the
 * operational phases will do; nothing here reads or writes the database, and
 * nothing here activates tracking.
 *
 * Quantities use the same 3-decimal rule as the rest of the app
 * (`Decimal(12,3)` columns) via {@link round3} from `sale-math`.
 *
 * See .ai/phase4-expiry-batch-design.md.
 */
import { round3 } from "@/lib/sale-math";
import { isExpiredOnDate, daysUntilExpiry } from "@/lib/timezone";

/** Batch lifecycle — mirrors the Prisma `BatchStatus` enum, redeclared here so
 *  this module stays free of generated Prisma types (client-safe). */
export type BatchStatus = "ACTIVE" | "DEPLETED" | "EXPIRED" | "ARCHIVED";

/**
 * The minimal shape the pure helpers need. A subset of the `ProductBatch` model,
 * declared locally so callers (server or test) can pass plain objects and this
 * module never imports Prisma types.
 */
export type BatchLike = {
  id: string;
  /** Date-only expiry (or null for lot-only tracking). Accepts Date or ISO string. */
  expiryDate: Date | string | null;
  /** When the lot was received — the FIFO tiebreak. Accepts Date or ISO string. */
  receivedAt: Date | string;
  /** Current on-hand units in this batch. */
  stock: number;
};

/** One line of an allocation plan: take `quantity` units from `batchId`. */
export type BatchAllocation = { batchId: string; quantity: number };

/** Result of {@link planBatchAllocation}. `ok:false` = not enough eligible stock. */
export type AllocationPlan =
  | { ok: true; allocations: BatchAllocation[] }
  | { ok: false; required: number; available: number; shortfall: number };

/** Thrown for programmer error (a non-finite/negative request), not for the
 *  ordinary "not enough stock" case (that returns `{ ok: false }`). */
export class InvalidAllocationRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAllocationRequest";
  }
}

/** Normalize a batch quantity to the app's 3-decimal resolution. */
export function normalizeBatchQuantity(n: number): number {
  return round3(n);
}

/** Milliseconds since epoch for a Date | ISO string; used only for ordering. */
function time(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * FEFO comparator (First-Expired-First-Out), with FIFO fallback for undated lots.
 * Ordering:
 *   1. earliest non-null `expiryDate` first,
 *   2. null-expiry batches after all dated batches,
 *   3. then earliest `receivedAt` (FIFO),
 *   4. then a stable `id` tiebreak (deterministic output).
 * Pure comparator — safe to pass to a copied array's `.sort()`.
 */
export function compareBatchesFEFO(a: BatchLike, b: BatchLike): number {
  const ax = a.expiryDate == null;
  const bx = b.expiryDate == null;
  if (ax !== bx) return ax ? 1 : -1; // dated batches before undated
  if (!ax && !bx) {
    const d = time(a.expiryDate as Date | string) - time(b.expiryDate as Date | string);
    if (d !== 0) return d;
  }
  const r = time(a.receivedAt) - time(b.receivedAt);
  if (r !== 0) return r;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Sorted FEFO copy — never mutates the input array. */
export function sortBatchesFEFO<T extends BatchLike>(batches: readonly T[]): T[] {
  return [...batches].sort(compareBatchesFEFO);
}

/**
 * Deterministic FEFO allocation plan for `requiredQuantity` across `batches`.
 *
 * - Decimal-safe at 0.001 (every take and the running remainder are `round3`).
 * - Batches with stock <= 0 are skipped (covers zero and negative stock).
 * - Splits across batches; never takes more than a batch holds.
 * - The sum of allocation quantities exactly equals `round3(requiredQuantity)`.
 * - Returns `{ ok:false, shortfall }` when eligible stock is insufficient.
 * - Never mutates the input array or its objects.
 *
 * Throws {@link InvalidAllocationRequest} only for a non-finite or
 * non-positive request (a caller bug), not for ordinary shortfalls.
 */
export function planBatchAllocation(
  requiredQuantity: number,
  batches: readonly BatchLike[]
): AllocationPlan {
  if (!Number.isFinite(requiredQuantity) || requiredQuantity <= 0) {
    throw new InvalidAllocationRequest(
      `requiredQuantity must be a positive finite number, got ${requiredQuantity}`
    );
  }
  const required = round3(requiredQuantity);

  const eligible = sortBatchesFEFO(batches.filter((b) => round3(b.stock) > 0));
  const available = batchStockTotal(eligible);

  if (available < required) {
    return { ok: false, required, available, shortfall: round3(required - available) };
  }

  const allocations: BatchAllocation[] = [];
  let remaining = required;
  for (const b of eligible) {
    if (remaining <= 0) break;
    const take = round3(Math.min(remaining, round3(b.stock)));
    if (take <= 0) continue;
    allocations.push({ batchId: b.id, quantity: take });
    remaining = round3(remaining - take);
  }

  // Defensive: with available >= required this should always land at 0. If a
  // 0.001 residue remains, add it to the last allocation so the sum is exact.
  if (remaining > 0 && allocations.length > 0) {
    const last = allocations[allocations.length - 1];
    last.quantity = round3(last.quantity + remaining);
    remaining = 0;
  }

  return { ok: true, allocations };
}

/** Round3 sum of batch stock (only `.stock` is read). */
export function batchStockTotal(batches: readonly { stock: number }[]): number {
  return round3(batches.reduce((sum, b) => sum + Number(b.stock), 0));
}

/** Structured comparison of the aggregate cache vs. the batch ledger. */
export type ReconcileResult = {
  aggregateStock: number;
  batchTotal: number;
  /** aggregate − batchTotal, round3 (positive = aggregate ahead of batches). */
  difference: number;
  /** True when the two agree at 0.001 resolution. */
  reconciled: boolean;
};

/**
 * Compares the maintained aggregate (`Product/ProductVariant.stock`) against the
 * sum of its batches. The Phase 4 invariant is that these agree for tracked
 * products; this is the tool a future reconciliation check/test uses to catch
 * drift.
 */
export function reconcileBatchStock(
  aggregateStock: number,
  batches: readonly { stock: number }[]
): ReconcileResult {
  const aggregate = round3(aggregateStock);
  const batchTotal = batchStockTotal(batches);
  const difference = round3(aggregate - batchTotal);
  return { aggregateStock: aggregate, batchTotal, difference, reconciled: difference === 0 };
}

/**
 * Pure, time-zone-independent batch status transitions.
 *
 * Deliberately does NOT evaluate expiry against "now" — expired-vs-not is a
 * time-zone-dependent policy deferred to the enforcement phase. This helper only
 * covers the unambiguous transitions:
 *  - a manually ARCHIVED batch stays ARCHIVED,
 *  - stock <= 0 → DEPLETED,
 *  - stock > 0 → ACTIVE (revives a DEPLETED batch after a return).
 * `isExpired` is an OPTIONAL, caller-supplied decision (already evaluated in the
 * store's time zone elsewhere); when true it wins over ACTIVE/DEPLETED for a
 * still-stocked batch.
 */
export function deriveBatchStatus(
  current: BatchStatus,
  stock: number,
  isExpired?: boolean
): BatchStatus {
  if (current === "ARCHIVED") return "ARCHIVED";
  if (round3(stock) <= 0) return "DEPLETED";
  if (isExpired === true) return "EXPIRED";
  return "ACTIVE";
}

/**
 * Validates the per-product tracking configuration: `trackExpiry` cannot be true
 * unless `trackBatch` is also true (expiry dates live on batches). All other
 * combinations are valid, including both-false (the dormant default).
 */
export function isBatchTrackingConfigurationValid(
  trackBatch: boolean,
  trackExpiry: boolean
): boolean {
  if (trackExpiry && !trackBatch) return false;
  return true;
}

// ── Expiry eligibility (Phase 4c1) ───────────────────────────────────────────
//
// Timezone maths live in `src/lib/timezone.ts`; these helpers take an
// already-computed store-local `storeToday` (YYYY-MM-DD) so they stay pure and
// separate from allocation. "Sellable" always requires the expiry comparison —
// never trust BatchStatus alone, which may lag behind the calendar.

export type BatchExpiryState = "valid" | "expires_today" | "expired" | "missing_date";

/** Classify a batch's expiry for display/enforcement given the store-local today. */
export function batchExpiryState(
  expiryDate: Date | string | null,
  storeToday: string
): BatchExpiryState {
  if (expiryDate == null) return "missing_date";
  if (isExpiredOnDate(expiryDate, storeToday)) return "expired";
  return daysUntilExpiry(expiryDate, storeToday) === 0 ? "expires_today" : "valid";
}

/** Minimal batch shape for sellability checks. */
export type SellableBatch = {
  status: BatchStatus;
  stock: number;
  expiryDate: Date | string | null;
};

/**
 * Whether a batch may be sold RIGHT NOW. Requires ACTIVE status and positive
 * stock; for an expiry-tracked product it additionally requires a non-null
 * expiry date that is not before `storeToday` (expiring today is still fine).
 * The expiryDate comparison is authoritative even if `status` hasn't been swept
 * to EXPIRED yet.
 */
export function isBatchSellable(
  batch: SellableBatch,
  opts: { trackExpiry: boolean; storeToday: string }
): boolean {
  if (batch.status !== "ACTIVE") return false;
  if (round3(batch.stock) <= 0) return false;
  if (!opts.trackExpiry) return true;
  if (batch.expiryDate == null) return false;
  return !isExpiredOnDate(batch.expiryDate, opts.storeToday);
}

/** Filter to only the batches sellable now (preserves input order; no mutation). */
export function filterSellableBatches<T extends SellableBatch>(
  batches: readonly T[],
  opts: { trackExpiry: boolean; storeToday: string }
): T[] {
  return batches.filter((b) => isBatchSellable(b, opts));
}

/** A batch that can be considered for sale allocation (needs its status too). */
export type AllocatableBatch = BatchLike & { status: BatchStatus };

/** One allocation, tagged with whether it drew from an expired batch (Phase 5). */
export type ExpiryAwareAllocation = BatchAllocation & { fromExpired: boolean };

export type ExpiryAwareAllocationResult =
  | { ok: true; allocations: ExpiryAwareAllocation[] }
  | { ok: false; shortfall: number };

/**
 * Sale allocation that is expiry-aware (Phase 5). Pure — no DB.
 *
 * - Batch-only product (`trackExpiry:false`): plain FIFO over the given batches.
 * - Expiry-tracked: allocate NON-EXPIRED sellable batches first (FEFO). Expired
 *   batches are drawn ONLY when `allowExpired` (a Manager override) is set AND the
 *   non-expired pool can't cover the line — so a sale that doesn't need expired
 *   stock never touches it. ARCHIVED/DEPLETED are always excluded; expired
 *   allocations are tagged `fromExpired:true`.
 */
export function planExpiryAwareAllocation(
  required: number,
  batches: readonly AllocatableBatch[],
  opts: { trackExpiry: boolean; storeToday: string; allowExpired: boolean }
): ExpiryAwareAllocationResult {
  const tag = (a: BatchAllocation, fromExpired: boolean): ExpiryAwareAllocation => ({ ...a, fromExpired });

  if (!opts.trackExpiry) {
    const plan = planBatchAllocation(required, batches);
    if (!plan.ok) return { ok: false, shortfall: plan.shortfall };
    return { ok: true, allocations: plan.allocations.map((a) => tag(a, false)) };
  }

  const sellable = filterSellableBatches(batches, { trackExpiry: true, storeToday: opts.storeToday });
  const planA = planBatchAllocation(required, sellable);
  if (planA.ok) return { ok: true, allocations: planA.allocations.map((a) => tag(a, false)) };

  if (!opts.allowExpired) return { ok: false, shortfall: planA.shortfall };

  // Take all non-expired first, then the remainder from expired-by-date batches.
  const nonExpiredTotal = batchStockTotal(sellable);
  const nonExpiredAllocs =
    nonExpiredTotal > 0
      ? (planBatchAllocation(nonExpiredTotal, sellable) as { ok: true; allocations: BatchAllocation[] }).allocations
      : [];
  const remainder = round3(required - nonExpiredTotal);
  const expiredPool = batches.filter(
    (b) =>
      (b.status === "ACTIVE" || b.status === "EXPIRED") &&
      round3(b.stock) > 0 &&
      b.expiryDate != null &&
      isExpiredOnDate(b.expiryDate, opts.storeToday)
  );
  const planB = planBatchAllocation(remainder, expiredPool);
  if (!planB.ok) return { ok: false, shortfall: planB.shortfall };
  return {
    ok: true,
    allocations: [...nonExpiredAllocs.map((a) => tag(a, false)), ...planB.allocations.map((a) => tag(a, true))],
  };
}

export type ExpiryAssignment = { batchId: string; expiryDate: string };

/**
 * Pure validation for activating expiry tracking on a product. `requiredBatchIds`
 * are the product's positive-stock, non-archived batches (all must get a date);
 * `assignments` is the Manager's submitted date per batch. DB/ownership checks
 * happen in the action — this validates completeness, foreignness, duplicates,
 * date shape, and that no date precedes `storeToday`. Returns a normalized map.
 */
export function validateExpiryTrackingActivation(
  requiredBatchIds: readonly string[],
  assignments: readonly ExpiryAssignment[],
  storeToday: string
): { ok: true; dates: Map<string, string> } | { ok: false; error: string } {
  const required = new Set(requiredBatchIds);
  const dates = new Map<string, string>();
  for (const a of assignments) {
    if (!required.has(a.batchId)) {
      return { ok: false, error: `Unknown or foreign batch: ${a.batchId}` };
    }
    if (dates.has(a.batchId)) {
      return { ok: false, error: `Duplicate date for batch: ${a.batchId}` };
    }
    if (!isValidDateKey(a.expiryDate)) {
      return { ok: false, error: `Invalid date for batch ${a.batchId}` };
    }
    if (a.expiryDate < storeToday) {
      return { ok: false, error: `Expiry date cannot be before today for batch ${a.batchId}` };
    }
    dates.set(a.batchId, a.expiryDate);
  }
  for (const id of required) {
    if (!dates.has(id)) return { ok: false, error: "Every current batch with stock needs an expiry date." };
  }
  return { ok: true, dates };
}

/** True for a real YYYY-MM-DD calendar date. */
export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ── Return / deletion restoration planning ───────────────────────────────────

/** Minimal shape of a SaleItemBatchAllocation for restoration planning. */
export type AllocationLike = {
  id: string;
  batchId: string;
  quantity: number;
  returnedQuantity: number;
};

/** One restoration step: give `quantity` units back to `batchId` via `allocationId`. */
export type Restoration = { allocationId: string; batchId: string; quantity: number };

export type RestorationPlan =
  | { ok: true; restorations: Restoration[] }
  | { ok: false; reason: "insufficient_allocation" | "missing_allocation"; capacity: number };

/**
 * Plans how to return `returnQuantity` units back to the ORIGINAL batches of a
 * SaleItem. Fills allocations in the given order (pass them createdAt-ascending),
 * never returning more than each allocation still owes
 * (`quantity - returnedQuantity`). Decimal-safe at 0.001. Pure — no mutation.
 *
 * Returns `{ ok:false }` when the allocations can't cover the request (missing
 * rows, or already fully returned) so the caller can abort the transaction.
 */
export function planReturnRestoration(
  returnQuantity: number,
  allocations: readonly AllocationLike[]
): RestorationPlan {
  const need0 = round3(returnQuantity);
  const capacity = round3(
    allocations.reduce((s, a) => s + Math.max(0, round3(a.quantity - a.returnedQuantity)), 0)
  );
  if (allocations.length === 0) return { ok: false, reason: "missing_allocation", capacity: 0 };
  if (capacity < need0) return { ok: false, reason: "insufficient_allocation", capacity };

  const restorations: Restoration[] = [];
  let remaining = need0;
  for (const a of allocations) {
    if (remaining <= 0) break;
    const owed = round3(a.quantity - a.returnedQuantity);
    if (owed <= 0) continue;
    const give = round3(Math.min(remaining, owed));
    restorations.push({ allocationId: a.id, batchId: a.batchId, quantity: give });
    remaining = round3(remaining - give);
  }
  return { ok: true, restorations };
}

/**
 * Plans restoration for a HARD sale deletion: give back every allocation's
 * *outstanding* units (`quantity - returnedQuantity`). The total must equal the
 * SaleItem's own outstanding (`quantity - returnedQuantity`); a mismatch means
 * the allocation history is missing/inconsistent and the caller must abort
 * (never guess a batch, never touch only the aggregate). Pure — no mutation.
 */
export function planDeletionRestoration(
  saleItemOutstanding: number,
  allocations: readonly AllocationLike[]
): { ok: true; restorations: Restoration[] } | { ok: false; reason: string; allocationTotal: number } {
  const outstanding = round3(saleItemOutstanding);
  const restorations: Restoration[] = allocations
    .map((a) => ({ allocationId: a.id, batchId: a.batchId, quantity: round3(a.quantity - a.returnedQuantity) }))
    .filter((r) => r.quantity > 0);
  const allocationTotal = round3(restorations.reduce((s, r) => s + r.quantity, 0));

  if (outstanding <= 0) {
    // Nothing owed to stock (already fully returned). Allocations must agree.
    if (allocationTotal !== 0) {
      return { ok: false, reason: "allocation_outstanding_mismatch", allocationTotal };
    }
    return { ok: true, restorations: [] };
  }
  if (allocations.length === 0) {
    return { ok: false, reason: "missing_allocation", allocationTotal };
  }
  if (allocationTotal !== outstanding) {
    return { ok: false, reason: "allocation_outstanding_mismatch", allocationTotal };
  }
  return { ok: true, restorations };
}
