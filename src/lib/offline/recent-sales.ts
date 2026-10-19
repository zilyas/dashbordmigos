/**
 * Pure derivations for the offline till's read-only surfaces: the recent-sales
 * list, the stock figure on a product tile, and the lease banner.
 *
 * No IndexedDB and no fetch in this file, on purpose. Every rule here is one a
 * cashier would notice getting broken — a sale listed twice, a unit offered that
 * was already sold offline — so each one is worth a unit test that runs in
 * microseconds with no browser around it. The callers in ./sync.ts and the UI
 * pass data in; this file only does arithmetic and sorting.
 */
import type { CachedProduct, CachedRecentSale, PendingSale } from "./db";
import { verifyLease, type LeasePayload, type LeaseVerification } from "./lease";

/** The till only ever shows 10, matching RECENT_SALES_LIMIT on the server. */
export const RECENT_SALES_LIMIT = 10;

export type RecentSaleRow = {
  /** Stable React key: the client id when we have one, else the server id. */
  key: string;
  /** Server id, absent while the sale is still queued. */
  saleId?: string;
  clientSaleId?: string;
  /** Absent until the server has issued one — queued sales have no invoice. */
  invoiceNumber: string | null;
  total: number;
  createdAt: string;
  customerName: string | null;
  paymentMethod: string;
  itemCount: number;
  /** Drives the "waiting to sync" / "needs review" marker in the list. */
  state: "synced" | "pending" | "review";
};

function pendingToRow(sale: PendingSale): RecentSaleRow {
  return {
    key: sale.clientSaleId,
    saleId: sale.serverSaleId,
    clientSaleId: sale.clientSaleId,
    invoiceNumber: sale.invoiceNumber ?? null,
    total: sale.expectedTotal,
    createdAt: sale.createdAt,
    customerName: sale.sale.customerName?.trim() ? sale.sale.customerName : null,
    paymentMethod: sale.sale.paymentMethod,
    itemCount: sale.sale.items.length,
    state: sale.status === "review" ? "review" : sale.status === "synced" ? "synced" : "pending",
  };
}

function serverToRow(sale: CachedRecentSale): RecentSaleRow {
  return {
    key: sale.id,
    saleId: sale.id,
    invoiceNumber: sale.invoiceNumber,
    total: sale.total,
    createdAt: sale.createdAt,
    customerName: sale.customerName,
    paymentMethod: sale.paymentMethod,
    itemCount: sale.itemCount,
    state: "synced",
  };
}

/**
 * One list from the cached server sales plus the local queue: newest first, at
 * most RECENT_SALES_LIMIT rows, de-duplicated.
 *
 * The de-duplication is the whole reason this function exists. A sale can
 * legitimately appear in BOTH inputs: the drain confirms it, the local record is
 * kept until a refreshed snapshot proves the server has it, and that snapshot
 * then lists it too. Rendering both copies tells the cashier they charged the
 * customer twice, and they will refund money that was only ever taken once.
 *
 * Local records win, and matching happens on `clientSaleId` first because that
 * is the only id both sides share for a sale the till originated; the server
 * `id` is the fallback for a local record that already learned its server id.
 */
export function mergeRecentSales(
  serverSales: readonly CachedRecentSale[],
  pendingSales: readonly PendingSale[],
  limit: number = RECENT_SALES_LIMIT
): RecentSaleRow[] {
  const rows: RecentSaleRow[] = [];
  const seenClientIds = new Set<string>();
  const seenServerIds = new Set<string>();

  // Local first, so a confirmed-but-not-yet-pruned sale keeps its local row and
  // the server copy of the same sale is the one dropped.
  for (const sale of pendingSales) {
    if (seenClientIds.has(sale.clientSaleId)) continue;
    seenClientIds.add(sale.clientSaleId);
    if (sale.serverSaleId) seenServerIds.add(sale.serverSaleId);
    rows.push(pendingToRow(sale));
  }

  for (const sale of serverSales) {
    if (seenServerIds.has(sale.id)) continue;
    seenServerIds.add(sale.id);
    rows.push(serverToRow(sale));
  }

  // Tie-break on key so two sales rung up in the same millisecond keep a stable
  // order between renders instead of flickering.
  rows.sort((a, b) => {
    const delta = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return delta !== 0 ? delta : a.key.localeCompare(b.key);
  });
  return rows.slice(0, Math.max(0, limit));
}

/* ---------- displayed stock ---------- */

/** `productId` for a plain product, `productId:variantId` for a variant line. */
export type StockKey = string;

export function stockKey(productId: string, variantId?: string | null): StockKey {
  return variantId ? `${productId}:${variantId}` : productId;
}

/**
 * Units committed by sales the server has not confirmed yet, per stock key.
 *
 * `review` sales are counted too: the goods physically left the shop, whatever
 * the server thinks of the paperwork. Only a `synced` sale is excluded, because
 * its decrement is already in the stock figure the next snapshot will bring.
 */
export function pendingQuantities(pendingSales: readonly PendingSale[]): Map<StockKey, number> {
  const held = new Map<StockKey, number>();
  for (const sale of pendingSales) {
    if (sale.status === "synced") continue;
    for (const item of sale.sale.items) {
      const key = stockKey(item.productId, item.variantId || null);
      held.set(key, (held.get(key) ?? 0) + item.quantity);
    }
  }
  return held;
}

/**
 * Cached stock minus everything the queue is holding, so the till stops offering
 * units it has already sold while dark. Without this, a cashier sells the last
 * shirt twice during one outage and the second sale comes back as
 * `insufficient_stock` at sync — after the customer has walked out with it.
 *
 * Floored at 0: a negative count on a tile reads as a bug, and the shortfall is
 * the server's to adjudicate at sync time anyway.
 */
export function displayedStock(
  product: Pick<CachedProduct, "id" | "stock" | "hasVariants" | "variants">,
  held: Map<StockKey, number>
): { stock: number; variants: Map<string, number> } {
  const variants = new Map<string, number>();
  for (const variant of product.variants) {
    const taken = held.get(stockKey(product.id, variant.id)) ?? 0;
    variants.set(variant.id, Math.max(0, variant.stock - taken));
  }

  if (product.hasVariants) {
    // Mirror the server: a variant product's headline stock is the sum of its
    // variants, never the parent column (see commit 2b29cc5). Any quantity
    // booked against the bare product id still counts — the UI can queue a
    // variantless line if the product only grew variants after the snapshot.
    let total = 0;
    for (const left of variants.values()) total += left;
    const takenOnParent = held.get(stockKey(product.id)) ?? 0;
    return { stock: Math.max(0, total - takenOnParent), variants };
  }

  const taken = held.get(stockKey(product.id)) ?? 0;
  return { stock: Math.max(0, product.stock - taken), variants };
}

/** Convenience: resolve the single number a tile should print. */
export function displayedStockFor(
  product: Pick<CachedProduct, "id" | "stock" | "hasVariants" | "variants">,
  held: Map<StockKey, number>,
  variantId?: string | null
): number {
  const computed = displayedStock(product, held);
  if (!variantId) return computed.stock;
  return computed.variants.get(variantId) ?? 0;
}

/* ---------- lease state ---------- */

/** Warn the cashier this far ahead of expiry, in milliseconds (24h). */
export const LEASE_EXPIRY_WARNING_MS = 24 * 60 * 60 * 1000;

export type LeaseState =
  | { status: "none" }
  | { status: "invalid"; reason: LeaseVerification["status"] }
  | { status: "valid"; expiresAt: Date; msRemaining: number; payload: LeasePayload }
  | { status: "expiring"; expiresAt: Date; msRemaining: number; payload: LeasePayload }
  | { status: "expired"; expiresAt: Date; payload: LeasePayload };

/**
 * Turn a verification result into the four things a banner can render. Kept
 * separate from `verifyLease` so the "expiring soon" threshold is a UI decision
 * and not baked into the crypto module — and so this is testable without keys.
 *
 * `expiring` is not a different kind of permission from `valid`: selling is
 * still allowed. It exists so the till can nag the cashier to reconnect while
 * there is still time, instead of going dead mid-shift.
 */
export function leaseStateFrom(
  verification: LeaseVerification | null,
  now: Date = new Date(),
  warningMs: number = LEASE_EXPIRY_WARNING_MS
): LeaseState {
  if (!verification) return { status: "none" };
  switch (verification.status) {
    case "expired":
      return {
        status: "expired",
        expiresAt: verification.expiresAt,
        payload: verification.payload,
      };
    case "valid": {
      const expiresAt = new Date(verification.payload.exp * 1000);
      const msRemaining = expiresAt.getTime() - now.getTime();
      return {
        status: msRemaining <= warningMs ? "expiring" : "valid",
        expiresAt,
        msRemaining,
        payload: verification.payload,
      };
    }
    default:
      // bad_signature / malformed / wrong_user all mean the same thing to a
      // cashier: this device needs to reconnect to get a usable lease.
      return { status: "invalid", reason: verification.status };
  }
}

/**
 * Verify a cached lease and reduce it to a renderable state in one step.
 * Returns `{ status: "none" }` when offline mode was never configured, which is
 * the normal state of a deployment that has not set the lease keys.
 */
export async function evaluateCachedLease(
  token: string | null | undefined,
  publicKey: string | null | undefined,
  expected?: { userId?: string; storeId?: string },
  now: Date = new Date()
): Promise<LeaseState> {
  if (!token || !publicKey) return { status: "none" };
  const verification = await verifyLease(token, publicKey, now, expected);
  return leaseStateFrom(verification, now);
}
