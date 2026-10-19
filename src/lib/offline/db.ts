/**
 * The till's local store. Plain IndexedDB on purpose: no Dexie, no wrapper.
 * The surface used here is four object stores and add/put/get/delete, and a
 * wrapper would buy nothing while putting a dependency between the shop's
 * takings and a library we do not control.
 *
 * WHAT IS AT STAKE, read before changing anything in `pendingSales`:
 * a record in `products` or `recentSales` is a cache — losing it costs a reload.
 * A record in `pendingSales` is MONEY THE SHOP HAS ALREADY TAKEN and that the
 * server has never heard of. There is no second copy anywhere. Every rule below
 * about strict durability, readback and `add()` exists because of that asymmetry.
 *
 * Nothing in here is a security control. The person standing at the till can
 * edit all of it with devtools open; see the SECURITY BOUNDARY note in
 * ./lease.ts. These stores exist to keep an honest till honest.
 */

export const DB_NAME = "pos-offline";
export const DB_VERSION = 1;

export const STORE_META = "meta";
export const STORE_PRODUCTS = "products";
export const STORE_RECENT_SALES = "recentSales";
export const STORE_PENDING_SALES = "pendingSales";

/* ---------- shapes mirroring the server contract ---------- */

/** One cached variant. No cost price and no image: see GET /api/pos/offline. */
export type CachedVariant = {
  id: string;
  sku: string;
  barcode: string | null;
  label: string;
  price: number;
  stock: number;
};

export type CachedProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  allowDecimalQuantity: boolean;
  price: number;
  stock: number;
  hasVariants: boolean;
  /** FEFO needs batch rows the till does not cache, so the UI refuses these. */
  trackBatch: boolean;
  variants: CachedVariant[];
};

export type CachedRecentSale = {
  id: string;
  invoiceNumber: string;
  total: number;
  createdAt: string;
  customerName: string | null;
  paymentMethod: string;
  itemCount: number;
};

export type OfflineConfig = {
  userId: string;
  role: string;
  storeId: string;
  storeName: string;
  currency: string;
  taxRate: number;
  unitsEnabled: boolean;
};

/** Exactly the body POST /api/pos/offline/sales validates, minus the lease. */
export type PendingSaleItem = {
  productId: string;
  variantId?: string;
  quantity: number;
};

export type PendingSaleBody = {
  customerName?: string;
  customerPhone?: string;
  discountPercent: number;
  paymentMethod: "CASH" | "CARD" | "TRANSFER" | "OTHER";
  items: PendingSaleItem[];
};

/**
 * `pending`  - not yet accepted by the server. Retry forever.
 * `review`   - the server refused it terminally (4xx). A human must decide;
 *              retrying cannot change the answer, so the drain walks past it.
 * `synced`   - confirmed, kept until a refreshed snapshot proves the server has
 *              it. Deleting on confirmation alone loses the sale if the refresh
 *              then fails and the record is already gone.
 */
export type PendingSaleStatus = "pending" | "review" | "synced";

export type PendingSale = {
  /** Idempotency key. Generated once when "Complete sale" was pressed. */
  clientSaleId: string;
  /** ISO. When the cashier rang it up, never when the upload happened. */
  createdAt: string;
  /** What went in the drawer. The server refuses a sale that drifts from it. */
  expectedTotal: number;
  /** Lease the sale was made under, carried so a later sync can prove it. */
  lease: string;
  sale: PendingSaleBody;
  status: PendingSaleStatus;
  /** Attempts so far — diagnostics only; nothing branches on the count. */
  attempts: number;
  /** Last failure as the server worded it, kept for the review screen. */
  lastError?: { code: string; message: string };
  /** Only for `price_changed`: lets the UI offer "sync at current prices". */
  serverTotal?: number;
  /** Set once the server accepts it, so the UI can show the invoice number. */
  serverSaleId?: string;
  invoiceNumber?: string;
};

export type SnapshotHeader = {
  /** `fetchedAt` from the snapshot response: how stale the catalogue is. */
  fetchedAt: string;
  config: OfflineConfig;
};

/** Keys in `meta`. One place, so a typo cannot silently create a new key. */
export const META_LEASE = "lease";
export const META_PUBLIC_KEY = "publicKey";
export const META_SNAPSHOT = "snapshot";
export const META_CLOCK_GUARD = "clockGuard";

/* ---------- promisified IndexedDB ---------- */

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Resolves only once the transaction has COMMITTED. Awaiting the individual
 * requests is not enough: a transaction can still abort (quota, or a constraint
 * failure elsewhere in the same tx) after every request reported success, and we
 * must not tell a cashier a sale is saved in that window.
 */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

let cached: Promise<IDBDatabase> | null = null;

export function openOfflineDb(): Promise<IDBDatabase> {
  if (cached) return cached;
  cached = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        db.createObjectStore(STORE_PRODUCTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_RECENT_SALES)) {
        db.createObjectStore(STORE_RECENT_SALES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_PENDING_SALES)) {
        const pending = db.createObjectStore(STORE_PENDING_SALES, { keyPath: "clientSaleId" });
        // Drain order is oldest sale first and the queue is read on every sync,
        // so the ordering is worth an index rather than a sort in JS.
        pending.createIndex("by_createdAt", "createdAt");
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // A second tab upgrading the schema blocks on our open connection. Close
      // instead of holding it hostage; the next call reopens.
      db.onversionchange = () => {
        db.close();
        cached = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open the offline DB"));
    request.onblocked = () =>
      reject(new Error("Another tab is holding an older version of the offline DB open"));
  }).catch((error: unknown) => {
    // Never cache a rejection: one transient open failure would otherwise leave
    // the till permanently unable to save anything for the rest of the session.
    cached = null;
    throw error;
  });
  return cached;
}

/** Tests only: drops the memoized handle so a fresh `indexedDB` is picked up. */
export function resetOfflineDbForTests(): void {
  cached = null;
}

/* ---------- meta ---------- */

async function metaGet<T>(key: string): Promise<T | undefined> {
  const db = await openOfflineDb();
  return wrap<T | undefined>(
    db.transaction(STORE_META, "readonly").objectStore(STORE_META).get(key) as IDBRequest<
      T | undefined
    >
  );
}

export function getLease(): Promise<string | undefined> {
  return metaGet<string>(META_LEASE);
}

export function getPublicKey(): Promise<string | undefined> {
  return metaGet<string>(META_PUBLIC_KEY);
}

export function getSnapshotHeader(): Promise<SnapshotHeader | undefined> {
  return metaGet<SnapshotHeader>(META_SNAPSHOT);
}

/* ---------- clock guard ---------- */

/**
 * Highest epoch-millis timestamp this device has ever seen, from either a server
 * response or a sale it created. If `Date.now()` comes back below it, the clock
 * has moved backwards and new offline sales are refused.
 *
 * ADVISORY ONLY. This value lives in IndexedDB, which anyone with devtools can
 * edit, and `Date.now()` is whatever the OS says. It catches an ACCIDENTAL clock
 * change (timezone fiddling, a dead CMOS battery) before the sale is made and
 * the goods leave, which is far kinder than catching it at sync time. The real
 * control is `verifyLeaseForSync` on the server, with a trusted clock. A pass
 * here proves nothing.
 */
export function getClockGuard(): Promise<number | undefined> {
  return metaGet<number>(META_CLOCK_GUARD);
}

/** Monotonic: only ever raises the mark, so a backwards jump cannot erase it. */
export async function raiseClockGuard(timestampMs: number): Promise<number> {
  if (!Number.isFinite(timestampMs)) throw new Error("clock guard needs a finite timestamp");
  const db = await openOfflineDb();
  const tx = db.transaction(STORE_META, "readwrite");
  const store = tx.objectStore(STORE_META);
  const current = await wrap<number | undefined>(
    store.get(META_CLOCK_GUARD) as IDBRequest<number | undefined>
  );
  const next = current === undefined ? timestampMs : Math.max(current, timestampMs);
  store.put(next, META_CLOCK_GUARD);
  await done(tx);
  return next;
}

/**
 * Reset, not raise: a snapshot carries the SERVER's time, the one clock worth
 * trusting. If the device had been running fast and pushed the guard into the
 * future, raising would leave the till refusing sales until real time caught up.
 * Server time overrides.
 */
export async function setClockGuardFromServer(serverTimeMs: number): Promise<void> {
  if (!Number.isFinite(serverTimeMs)) throw new Error("clock guard needs a finite timestamp");
  const db = await openOfflineDb();
  const tx = db.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put(serverTimeMs, META_CLOCK_GUARD);
  await done(tx);
}

export type ClockCheck = { ok: true } | { ok: false; guardMs: number; nowMs: number };

/** Advisory, as above. `now` is injectable so tests do not depend on the host. */
export async function checkClock(now: number = Date.now()): Promise<ClockCheck> {
  const guard = await getClockGuard();
  if (guard === undefined || now >= guard) return { ok: true };
  return { ok: false, guardMs: guard, nowMs: now };
}

/* ---------- snapshot ---------- */

export type OfflineSnapshot = {
  publicKey: string | null;
  lease: string | null;
  fetchedAt: string;
  config: OfflineConfig;
  products: CachedProduct[];
  recentSales: CachedRecentSale[];
};

/**
 * Replace the cached catalogue wholesale, in ONE transaction spanning all three
 * cache stores. A per-store transaction could leave products from the new
 * snapshot beside a header from the old one, and the UI would then price against
 * a catalogue it cannot date.
 *
 * `pendingSales` is not in the transaction's scope at all, so a snapshot refresh
 * is structurally incapable of touching the queue.
 */
export async function saveSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction([STORE_META, STORE_PRODUCTS, STORE_RECENT_SALES], "readwrite");
  const meta = tx.objectStore(STORE_META);
  const header: SnapshotHeader = { fetchedAt: snapshot.fetchedAt, config: snapshot.config };
  meta.put(header, META_SNAPSHOT);
  if (snapshot.publicKey !== null) meta.put(snapshot.publicKey, META_PUBLIC_KEY);
  // A null lease means offline mode is unconfigured for this deployment. Keep
  // whatever lease is already held rather than wiping it: a deployment that
  // briefly loses its keys must not strip a till of a window it is mid-way
  // through, and the server re-checks the lease at sync time anyway.
  if (snapshot.lease !== null) meta.put(snapshot.lease, META_LEASE);

  const products = tx.objectStore(STORE_PRODUCTS);
  products.clear();
  for (const product of snapshot.products) products.put(product);

  const recent = tx.objectStore(STORE_RECENT_SALES);
  recent.clear();
  for (const sale of snapshot.recentSales) recent.put(sale);

  await done(tx);
}

export async function getProducts(): Promise<CachedProduct[]> {
  const db = await openOfflineDb();
  return wrap(
    db.transaction(STORE_PRODUCTS, "readonly").objectStore(STORE_PRODUCTS).getAll() as IDBRequest<
      CachedProduct[]
    >
  );
}

export async function getRecentSales(): Promise<CachedRecentSale[]> {
  const db = await openOfflineDb();
  return wrap(
    db
      .transaction(STORE_RECENT_SALES, "readonly")
      .objectStore(STORE_RECENT_SALES)
      .getAll() as IDBRequest<CachedRecentSale[]>
  );
}

/* ---------- pending sales ---------- */

export type QueueResult =
  | { saved: true; record: PendingSale }
  /**
   * `saved: false` means THE SALE IS NOT ON DISK. The caller must keep the cart
   * on screen and must not print a receipt or open the drawer, because the only
   * remaining copy of this sale is in the page's memory.
   */
  | { saved: false; reason: "duplicate" | "readback_failed" | "write_failed"; error: string };

/**
 * Queue a completed offline sale.
 *
 * Three deliberate choices, each preventing one specific disaster:
 *
 * 1. `durability: "strict"` — the default ("relaxed") lets the browser report
 *    success before the OS has flushed, so a power cut at the till loses the
 *    sale that was just rung up. Strict costs milliseconds and is the only
 *    setting compatible with "this is money".
 * 2. `add()`, never `put()` — a double-submit (two clicks, or a UI that reuses
 *    an id) surfaces as a ConstraintError instead of silently overwriting a
 *    DIFFERENT sale filed under the same key, which would destroy takings with
 *    no trace at all.
 * 3. READ THE RECORD BACK, in a second transaction, after the first committed.
 *    A committed write we cannot then read means a broken store (quota games, a
 *    corrupted profile, a private-mode quirk), and reporting success on it hands
 *    the cashier a receipt for a sale that does not exist. If the readback
 *    fails we report `saved: false` so the caller keeps the cart on screen.
 */
export async function queueSale(
  input: Omit<PendingSale, "status" | "attempts">
): Promise<QueueResult> {
  const record: PendingSale = { ...input, status: "pending", attempts: 0 };

  let db: IDBDatabase;
  try {
    db = await openOfflineDb();
  } catch (error) {
    return { saved: false, reason: "write_failed", error: describeError(error) };
  }

  let addError: DOMException | null = null;
  try {
    const tx = db.transaction(STORE_PENDING_SALES, "readwrite", { durability: "strict" });
    const request = tx.objectStore(STORE_PENDING_SALES).add(record);
    // The request's own error is the only place the ConstraintError name
    // survives: by the time the transaction aborts, `tx.error` may already have
    // been flattened to the abort, and a duplicate must not be reported as an
    // unknown write failure — the two need different handling in the UI.
    request.onerror = () => {
      addError = request.error;
    };
    await done(tx);
  } catch (error) {
    const named = addError ?? error;
    const duplicate = named instanceof Error && named.name === "ConstraintError";
    return {
      saved: false,
      reason: duplicate ? "duplicate" : "write_failed",
      error: describeError(named),
    };
  }

  let readback: PendingSale | undefined;
  try {
    readback = await getPendingSale(record.clientSaleId);
  } catch (error) {
    return { saved: false, reason: "readback_failed", error: describeError(error) };
  }
  if (!readback) {
    return {
      saved: false,
      reason: "readback_failed",
      error: "the sale was written but could not be read back",
    };
  }
  return { saved: true, record: readback };
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function getPendingSale(clientSaleId: string): Promise<PendingSale | undefined> {
  const db = await openOfflineDb();
  return wrap<PendingSale | undefined>(
    db
      .transaction(STORE_PENDING_SALES, "readonly")
      .objectStore(STORE_PENDING_SALES)
      .get(clientSaleId) as IDBRequest<PendingSale | undefined>
  );
}

/** Every queued sale, oldest first — the order the drain must follow. */
export async function getPendingSales(): Promise<PendingSale[]> {
  const db = await openOfflineDb();
  return wrap<PendingSale[]>(
    db
      .transaction(STORE_PENDING_SALES, "readonly")
      .objectStore(STORE_PENDING_SALES)
      .index("by_createdAt")
      .getAll() as IDBRequest<PendingSale[]>
  );
}

/**
 * Merge a patch into one queued sale. Read-modify-write inside a single
 * transaction, so a status change cannot clobber a field another writer set
 * between the read and the write.
 *
 * Returns the stored record, or undefined if the sale is already gone.
 */
export async function updatePendingSale(
  clientSaleId: string,
  patch: Partial<Omit<PendingSale, "clientSaleId">>
): Promise<PendingSale | undefined> {
  const db = await openOfflineDb();
  const tx = db.transaction(STORE_PENDING_SALES, "readwrite", { durability: "strict" });
  const store = tx.objectStore(STORE_PENDING_SALES);
  const current = await wrap<PendingSale | undefined>(
    store.get(clientSaleId) as IDBRequest<PendingSale | undefined>
  );
  if (!current) {
    await done(tx);
    return undefined;
  }
  const next: PendingSale = { ...current, ...patch, clientSaleId };
  store.put(next);
  await done(tx);
  return next;
}

/**
 * Drop a queued sale. The only legitimate caller is the drain, and only once the
 * sale is both confirmed AND present in a freshly fetched snapshot — see
 * ./sync.ts. Deleting on confirmation alone loses the sale if the refresh fails.
 */
export async function deletePendingSale(clientSaleId: string): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction(STORE_PENDING_SALES, "readwrite", { durability: "strict" });
  tx.objectStore(STORE_PENDING_SALES).delete(clientSaleId);
  await done(tx);
}

/**
 * Wipe the CACHE and nothing else. Logout calls this, and so do lease expiry and
 * account suspension.
 *
 * `pendingSales` is deliberately absent from the transaction's store list, so
 * this function could not delete a queued sale even if someone later added a
 * `clear()` to it by mistake — IndexedDB would throw NotFoundError instead. That
 * is the point: an unsynced sale is cash the shop is owed, and signing out is
 * not a reason to destroy it. Whoever signs in next at that store uploads it.
 */
export async function clearCachedData(): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction([STORE_META, STORE_PRODUCTS, STORE_RECENT_SALES], "readwrite");
  tx.objectStore(STORE_META).clear();
  tx.objectStore(STORE_PRODUCTS).clear();
  tx.objectStore(STORE_RECENT_SALES).clear();
  await done(tx);
}
