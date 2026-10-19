/**
 * The sync engine: snapshot refresh, and the drain that uploads queued sales.
 *
 * THE RETRY RULE, which everything here hangs off, is the server's and not
 * ours. See the STATUS_BY_CODE comment in
 * src/app/api/pos/offline/sales/route.ts: every 4xx is TERMINAL for that sale
 * and every 5xx is RETRYABLE. Do not re-derive the split per code here — the
 * route is explicit that new codes stay consistent with that one rule rather
 * than carrying a retryable flag, so the client only has to read the status.
 *
 * Both directions of getting it wrong cost real money: a terminal error treated
 * as retryable spins the queue forever and buries the sale that needs a human,
 * and a transient error treated as terminal parks a sale the shop has already
 * taken cash for in a review list nobody reads.
 */
import {
  clearCachedData,
  checkClock,
  deletePendingSale,
  getLease,
  getPendingSale,
  getPendingSales,
  getProducts,
  getPublicKey,
  getRecentSales,
  getSnapshotHeader,
  queueSale,
  saveSnapshot,
  setClockGuardFromServer,
  raiseClockGuard,
  updatePendingSale,
  type CachedProduct,
  type CachedRecentSale,
  type OfflineConfig,
  type OfflineSnapshot,
  type PendingSale,
  type PendingSaleBody,
  type QueueResult,
} from "./db";

export const SNAPSHOT_URL = "/api/pos/offline";
export const SALES_URL = "/api/pos/offline/sales";
/** `navigator.onLine` is true on a captive portal, so we ask the server. */
export const HEALTH_URL = "/api/health";

const LOCK_NAME = "pos-offline-sync";
const HEALTH_TIMEOUT_MS = 5_000;
const UPLOAD_TIMEOUT_MS = 20_000;

type FetchLike = typeof fetch;

export type SyncDeps = {
  fetch?: FetchLike;
  /** Injectable so the clock guard can be tested without touching the host. */
  now?: () => number;
};

function resolveFetch(deps?: SyncDeps): FetchLike {
  const f = deps?.fetch ?? globalThis.fetch;
  if (!f) throw new Error("no fetch available for offline sync");
  return f;
}

/* ---------- connectivity ---------- */

/**
 * Ask the server whether it is really reachable.
 *
 * `navigator.onLine` only says the device has A network. On a cafe or hotel
 * captive portal it is true while every request is answered by the portal's own
 * login page, so a drain keyed off it would POST sales into a redirect and read
 * HTML as a failure — forever, with the cashier told "syncing". /api/health is
 * unauthenticated and does one `SELECT 1`, so it is the cheapest honest answer
 * available; a 503 from it means the database is down and uploads would 500.
 */
export async function confirmConnectivity(deps?: SyncDeps): Promise<boolean> {
  const doFetch = resolveFetch(deps);
  try {
    const response = await doFetch(HEALTH_URL, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body: unknown = await response.json().catch(() => null);
    // A captive portal can return 200 with HTML. Only our own shape counts.
    return !!body && typeof body === "object" && (body as { status?: unknown }).status === "ok";
  } catch {
    return false;
  }
}

/* ---------- snapshot refresh ---------- */

export type RefreshResult =
  | { ok: true; snapshot: OfflineSnapshot; leaseDenied: string | null }
  | { ok: false; reason: "unauthorized" | "forbidden" | "network" | "server" | "malformed"; message: string };

type SnapshotResponse = {
  publicKey: string | null;
  lease: string | null;
  leaseDenied: string | null;
  fetchedAt: string;
  config: OfflineConfig;
  products: CachedProduct[];
  recentSales: CachedRecentSale[];
};

/**
 * Fetch the snapshot, store it, and reset the clock guard to SERVER time.
 *
 * The guard is reset rather than raised here because `fetchedAt` comes from the
 * one clock we trust; see setClockGuardFromServer. Doing it on every refresh is
 * also what un-sticks a till whose clock had run fast.
 */
export async function refreshSnapshot(deps?: SyncDeps): Promise<RefreshResult> {
  const doFetch = resolveFetch(deps);
  let response: Response;
  try {
    response = await doFetch(SNAPSHOT_URL, { method: "GET", cache: "no-store" });
  } catch (error) {
    return { ok: false, reason: "network", message: describeError(error) };
  }

  if (!response.ok) {
    const message = await errorMessage(response);
    if (response.status === 401) return { ok: false, reason: "unauthorized", message };
    if (response.status >= 500) return { ok: false, reason: "server", message };
    return { ok: false, reason: "forbidden", message };
  }

  let body: SnapshotResponse;
  try {
    body = (await response.json()) as SnapshotResponse;
  } catch (error) {
    return { ok: false, reason: "malformed", message: describeError(error) };
  }
  if (!body || typeof body.fetchedAt !== "string" || !Array.isArray(body.products)) {
    return { ok: false, reason: "malformed", message: "snapshot is not in the expected shape" };
  }

  const snapshot: OfflineSnapshot = {
    publicKey: body.publicKey ?? null,
    lease: body.lease ?? null,
    fetchedAt: body.fetchedAt,
    config: body.config,
    products: body.products,
    recentSales: Array.isArray(body.recentSales) ? body.recentSales : [],
  };
  await saveSnapshot(snapshot);

  const serverTime = Date.parse(body.fetchedAt);
  if (Number.isFinite(serverTime)) await setClockGuardFromServer(serverTime);

  return { ok: true, snapshot, leaseDenied: body.leaseDenied ?? null };
}

/* ---------- recording a sale offline ---------- */

export type RecordResult =
  | QueueResult
  | { saved: false; reason: "no_lease"; error: string }
  | { saved: false; reason: "clock_moved_back"; error: string };

/**
 * Queue one completed offline sale.
 *
 * The clock guard check is ADVISORY — the guard lives in IndexedDB, which the
 * person at the till can edit, and `Date.now()` is whatever the OS reports. It
 * exists to catch an accidental backwards clock change (timezone fiddling, a
 * dead CMOS battery) BEFORE the goods leave the shop, because the server's
 * lease-window check will reject such a sale at sync time and that is far too
 * late to do anything about. The real control is `verifyLeaseForSync`.
 *
 * Any `saved: false` here means the sale is not on disk: keep the cart.
 */
export async function recordOfflineSale(
  clientSaleId: string,
  sale: PendingSaleBody,
  expectedTotal: number,
  deps?: SyncDeps
): Promise<RecordResult> {
  const nowMs = (deps?.now ?? Date.now)();
  const clock = await checkClock(nowMs);
  if (!clock.ok) {
    return {
      saved: false,
      reason: "clock_moved_back",
      error:
        `This device's clock reads ${new Date(clock.nowMs).toISOString()}, earlier than ` +
        `${new Date(clock.guardMs).toISOString()}, which it has already seen. Fix the clock ` +
        `before selling offline, or the sale will be rejected when it syncs.`,
    };
  }

  const lease = await getLease();
  if (!lease) {
    return {
      saved: false,
      reason: "no_lease",
      error: "This device has no offline lease. Reconnect once to get one.",
    };
  }

  const result = await queueSale({
    clientSaleId,
    createdAt: new Date(nowMs).toISOString(),
    expectedTotal,
    lease,
    sale,
  });
  if (result.saved) await raiseClockGuard(nowMs);
  return result;
}

/* ---------- uploading one sale ---------- */

export type UploadOutcome =
  /** Explicit `{ ok: true }`, including a replay of an earlier attempt. */
  | { kind: "accepted"; saleId: string; invoiceNumber: string; total: number; replayed: boolean }
  /** 5xx, a network error or a timeout. Stays pending, untouched. */
  | { kind: "retry"; message: string }
  /** 4xx other than 401. Terminal for this sale; a human must look. */
  | { kind: "terminal"; code: string; message: string; serverTotal?: number }
  /** 401. Retrying cannot help: the queue stops until someone signs in. */
  | { kind: "signed_out"; message: string };

type SalesSuccess = {
  ok: true;
  saleId: string;
  invoiceNumber: string;
  replayed: boolean;
  total: number;
};
type SalesFailure = { error?: { code?: string; message?: string; serverTotal?: number } };

/**
 * POST one queued sale under its ORIGINAL `clientSaleId`. That id is the
 * server's idempotency key, so a sale whose response was lost in transit is
 * recognised on the next attempt and comes back `replayed: true` instead of
 * being recorded a second time. Generating a fresh id on retry would bill the
 * customer twice; nothing in this module ever mints one.
 */
export async function uploadPendingSale(sale: PendingSale, deps?: SyncDeps): Promise<UploadOutcome> {
  const doFetch = resolveFetch(deps);
  let response: Response;
  try {
    response = await doFetch(SALES_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      body: JSON.stringify({
        clientSaleId: sale.clientSaleId,
        lease: sale.lease,
        createdAt: sale.createdAt,
        expectedTotal: sale.expectedTotal,
        sale: sale.sale,
      }),
    });
  } catch (error) {
    // Includes the timeout. We have NO idea whether the server recorded it, so
    // the sale stays pending and the idempotency key sorts it out next time.
    return { kind: "retry", message: describeError(error) };
  }

  if (response.status === 401) {
    return { kind: "signed_out", message: await errorMessage(response) };
  }
  // The rule, in one place: 5xx (and anything stranger) is retryable.
  if (response.status >= 500) {
    return { kind: "retry", message: await errorMessage(response) };
  }
  if (response.status >= 400) {
    let body: SalesFailure | null = null;
    try {
      body = (await response.json()) as SalesFailure;
    } catch {
      body = null;
    }
    return {
      kind: "terminal",
      code: body?.error?.code ?? `http_${response.status}`,
      message: body?.error?.message ?? `The server rejected this sale (${response.status}).`,
      // Carried only by price_changed, and the UI needs it to offer "sync at
      // current prices". Dropping it would make that offer impossible.
      ...(typeof body?.error?.serverTotal === "number"
        ? { serverTotal: body.error.serverTotal }
        : {}),
    };
  }

  let body: SalesSuccess | null = null;
  try {
    body = (await response.json()) as SalesSuccess;
  } catch {
    body = null;
  }
  // Mark synced ONLY on an explicit ok:true. A 2xx with an unreadable body is
  // most likely a proxy or a portal answering for the server, and treating it
  // as success would drop a sale that never reached us.
  if (!body || body.ok !== true || typeof body.saleId !== "string") {
    return { kind: "retry", message: "the server replied 2xx without a usable confirmation" };
  }
  return {
    kind: "accepted",
    saleId: body.saleId,
    invoiceNumber: body.invoiceNumber,
    total: body.total,
    // `replayed` means an earlier attempt already landed it. Identical handling
    // to a fresh success: the sale exists on the server exactly once.
    replayed: body.replayed === true,
  };
}

/* ---------- the drain ---------- */

export type SyncSummary = {
  /** False when another tab or an in-flight run already held the lock. */
  ran: boolean;
  uploaded: number;
  replayed: number;
  review: number;
  retry: number;
  /** Removed locally: confirmed AND present in the refreshed snapshot. */
  pruned: number;
  stopped: "signed_out" | "offline" | "snapshot_failed" | null;
  message?: string;
};

const EMPTY: SyncSummary = {
  ran: true,
  uploaded: 0,
  replayed: 0,
  review: 0,
  retry: 0,
  pruned: 0,
  stopped: null,
};

/**
 * Fallback mutex for browsers without the Web Locks API (Safari before 15.4).
 * Module-scoped, so it only covers one JS context — which is exactly what it is
 * for: Web Locks covers across tabs, this covers two overlapping calls in one.
 */
let inFlight = false;

async function withSyncLock<T>(run: () => Promise<T>, busy: () => T): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks) {
    // `ifAvailable` rather than waiting: a queued second run would upload the
    // same (by then already-uploaded) sales as soon as the first finished, and
    // there is nothing for it to do anyway. Returning "busy" is the honest
    // answer, and the caller's next interval tick picks it up.
    const result = await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) return { held: false as const };
      return { held: true as const, value: await run() };
    });
    return result.held ? result.value : busy();
  }

  // Set the flag BEFORE the first await so two synchronous calls cannot both
  // pass the check. Two tabs on one till will each run their own drain in this
  // fallback, which is why the idempotency key — not this flag — is what
  // actually prevents a double charge.
  if (inFlight) return busy();
  inFlight = true;
  try {
    return await run();
  } finally {
    inFlight = false;
  }
}

/**
 * Upload everything queued, then prune what the server demonstrably has.
 *
 * Shape of the run, and every step of it is load-bearing:
 *  1. One sync at a time per browser (Web Locks, in-memory flag as fallback).
 *     Two concurrent drains over one queue is how a sale lands twice.
 *  2. Confirm real connectivity before touching the queue.
 *  3. Upload oldest first, ONE AT A TIME, never in parallel. Invoice numbers
 *     then come out in the order the sales were made, and a single 401 stops the
 *     run before the rest of the queue hammers the same wall.
 *  4. Refresh the snapshot afterwards and delete only the confirmed sales it
 *     actually lists. A sale deleted on confirmation alone is gone if that
 *     refresh fails, and nothing would ever prove the server has it.
 */
export async function syncNow(deps?: SyncDeps): Promise<SyncSummary> {
  return withSyncLock(
    () => drain(deps),
    () => ({ ...EMPTY, ran: false })
  );
}

async function drain(deps?: SyncDeps): Promise<SyncSummary> {
  const summary: SyncSummary = { ...EMPTY };

  if (!(await confirmConnectivity(deps))) {
    return { ...summary, stopped: "offline", message: "The server is not reachable." };
  }

  const queue = await getPendingSales();
  const confirmed = new Set<string>();
  for (const sale of queue) {
    // `review` is terminal and `synced` is awaiting proof from a snapshot;
    // re-uploading either would, at best, burn a request.
    if (sale.status !== "pending") {
      if (sale.status === "synced") confirmed.add(sale.clientSaleId);
      continue;
    }

    const outcome = await uploadPendingSale(sale, deps);
    if (outcome.kind === "signed_out") {
      // Stop the WHOLE queue. The session is gone, so every remaining sale
      // would get the same 401, and the cashier has to sign in again.
      return { ...summary, stopped: "signed_out", message: outcome.message };
    }

    if (outcome.kind === "retry") {
      summary.retry += 1;
      await updatePendingSale(sale.clientSaleId, {
        attempts: sale.attempts + 1,
        lastError: { code: "retry", message: outcome.message },
      });
      continue;
    }

    if (outcome.kind === "terminal") {
      summary.review += 1;
      await updatePendingSale(sale.clientSaleId, {
        status: "review",
        attempts: sale.attempts + 1,
        lastError: { code: outcome.code, message: outcome.message },
        // Kept verbatim for price_changed so the UI can show both figures and
        // offer to re-send at the current catalogue price.
        ...(outcome.serverTotal !== undefined ? { serverTotal: outcome.serverTotal } : {}),
      });
      continue;
    }

    summary.uploaded += 1;
    if (outcome.replayed) summary.replayed += 1;
    await updatePendingSale(sale.clientSaleId, {
      status: "synced",
      attempts: sale.attempts + 1,
      serverSaleId: outcome.saleId,
      invoiceNumber: outcome.invoiceNumber,
      lastError: undefined,
    });
    confirmed.add(sale.clientSaleId);
  }

  if (confirmed.size === 0) return summary;

  // Only now, with the server's own list in hand, is a local delete safe.
  const refreshed = await refreshSnapshot(deps);
  if (!refreshed.ok) {
    return {
      ...summary,
      stopped: refreshed.reason === "unauthorized" ? "signed_out" : "snapshot_failed",
      message: refreshed.message,
    };
  }

  const serverSaleIds = new Set(refreshed.snapshot.recentSales.map((s) => s.id));
  for (const clientSaleId of confirmed) {
    const record = await getPendingSale(clientSaleId);
    // `serverSaleId` is set in the same update as `synced`, so its absence here
    // means something else rewrote the record; leave it for a human.
    if (!record?.serverSaleId) continue;
    if (!serverSaleIds.has(record.serverSaleId)) continue;
    await deletePendingSale(clientSaleId);
    summary.pruned += 1;
  }
  return summary;
}

/* ---------- logout ---------- */

/**
 * Sign-out path. Wipes the cached catalogue, lease and clock guard and LEAVES
 * THE QUEUE: an unsynced sale is cash the shop is owed, and it is re-uploadable
 * by whoever signs in next at that store. See clearCachedData.
 */
export async function clearOfflineCacheOnLogout(): Promise<void> {
  await clearCachedData();
}

/* ---------- read helpers for the UI layer ---------- */

export type OfflineState = {
  header: Awaited<ReturnType<typeof getSnapshotHeader>>;
  lease: string | undefined;
  publicKey: string | undefined;
  products: CachedProduct[];
  recentSales: CachedRecentSale[];
  pendingSales: PendingSale[];
};

/** One round trip to IndexedDB for everything the till renders from. */
export async function loadOfflineState(): Promise<OfflineState> {
  const [header, lease, publicKey, products, recentSales, pendingSales] = await Promise.all([
    getSnapshotHeader(),
    getLease(),
    getPublicKey(),
    getProducts(),
    getRecentSales(),
    getPendingSales(),
  ]);
  return { header, lease, publicKey, products, recentSales, pendingSales };
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as SalesFailure;
    return body?.error?.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}
