/**
 * Decision logic for the offline till, kept out of the component so each rule
 * is unit-testable. The POS renders what these functions decide; it does not
 * re-derive any of it inline.
 */
import type { CachedProduct } from "@/lib/offline/db";
import { displayedStock } from "@/lib/offline/recent-sales";
import type { LeaseState, StockKey } from "@/lib/offline/recent-sales";
import type { RecordResult } from "@/lib/offline/sync";
import { matchesAny } from "@/lib/text";

/** One product tile as the offline grid should render it. */
export type OfflineProductRow = {
  product: CachedProduct;
  /** Cached stock minus everything the unsynced queue already committed. */
  stock: number;
  /** Same subtraction per variant id, for the picker. */
  variantStock: Map<string, number>;
  /** Non-null when the till must refuse this product; the text is shown as-is. */
  blocked: string | null;
};

/**
 * Batch-tracked products need FEFO allocation over batch rows the snapshot does
 * not carry, and `/api/pos/sales` rejects them outright. Refusing at the tile is
 * the only point where the goods have not left the shop yet — a refusal at sync
 * time is a loss, not a validation.
 */
export function offlineBlockReason(product: Pick<CachedProduct, "trackBatch">): string | null {
  return product.trackBatch
    ? "Batch-tracked — needs expiry allocation that only the online till can do."
    : null;
}

/**
 * The offline catalogue: cached products, searched and stock-adjusted.
 *
 * Search spans the same fields the online till does (name, SKU, barcode, and
 * each variant's SKU and label) so a barcode scan still resolves while dark;
 * losing scan-to-sell offline would be the whole point of the feature gone.
 */
export function offlineCatalogue(
  products: readonly CachedProduct[],
  held: Map<StockKey, number>,
  query: string
): OfflineProductRow[] {
  const q = query.trim();
  return products
    .filter(
      (p) =>
        !q ||
        matchesAny(
          [p.name, p.sku, p.barcode, ...p.variants.flatMap((v) => [v.sku, v.barcode, v.label])],
          q
        )
    )
    .map((product) => {
      const computed = displayedStock(product, held);
      return {
        product,
        stock: computed.stock,
        variantStock: computed.variants,
        blocked: offlineBlockReason(product),
      };
    });
}

/**
 * `reason` lets the UI tell three refusals apart without re-reading the lease:
 * a window that ran out, a device that never had one, and a permit that will
 * not verify. All three block new sales; only the wording differs.
 */
export type OfflineGateReason = "expired" | "none" | "unusable";

export type OfflineGate =
  | { allowed: true }
  | { allowed: false; reason: OfflineGateReason; message: string };

/**
 * May this device start a NEW offline sale?
 *
 * Only the lease decides. A refusal here must never touch the queue: sales
 * already taken are cash in the drawer and still have to sync, so an expired
 * lease stops new sales and nothing else.
 */
export function offlineSaleGate(lease: LeaseState): OfflineGate {
  switch (lease.status) {
    case "valid":
    case "expiring":
      return { allowed: true };
    case "expired":
      return {
        allowed: false,
        reason: "expired",
        // Naming the date is what tells the cashier whether this is a five-minute
        // reconnect or a week-old device nobody has signed into.
        message: `Offline selling expired on ${lease.expiresAt.toLocaleString()}. Reconnect once to renew it.`,
      };
    case "none":
      return {
        allowed: false,
        reason: "none",
        message: "This device has no offline permit. Reconnect once while online to get one.",
      };
    default:
      return {
        allowed: false,
        reason: "unusable",
        message: `This device's offline permit is not usable (${lease.reason}). Reconnect once to replace it.`,
      };
  }
}

export type RecordToast = { ok: boolean; message: string };

/**
 * Map a `RecordResult` to what the cashier is told.
 *
 * `ok: false` means the sale is NOT on disk, so the caller keeps the cart. The
 * one exception in wording is `duplicate`: the id is already filed, so a second
 * copy must not be rung up — the pending list is where to look.
 */
export function describeRecordResult(result: RecordResult): RecordToast {
  if (result.saved) return { ok: true, message: "Sale saved offline — waiting to sync." };
  switch (result.reason) {
    case "duplicate":
      return {
        ok: false,
        message:
          "This sale is already queued on this device. Check the pending sales before ringing it again.",
      };
    case "readback_failed":
    case "write_failed":
      return {
        ok: false,
        message: `Not saved — this device's local storage refused the sale (${result.error}). Keep the cart and do not hand over the goods.`,
      };
    default:
      // no_lease / clock_moved_back already read as a sentence for the cashier.
      return { ok: false, message: `Not saved — ${result.error}` };
  }
}
