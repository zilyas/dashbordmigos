"use client";

import { useEffect, useState } from "react";
import { useOffline } from "next/offline";
import { loadOfflineState } from "@/lib/offline/sync";
import { evaluateCachedLease } from "@/lib/offline/recent-sales";

/**
 * The offline till's client entry point.
 *
 * Everything on screen comes from IndexedDB. Nothing here may fetch: this
 * component is mounted by a page the service worker served from its precache,
 * on a device whose network is gone, so a fetch would only hang.
 *
 * BOUNDARY — the local store lives in `src/lib/offline/db.ts` (owned by another
 * agent, built in parallel; deliberately not imported yet so this page keeps
 * compiling and keeps prerendering on its own). The two types below are the
 * ONLY shape this component needs, and `readSnapshot` is the one call it makes.
 * When db.ts lands, delete the stub and replace it with:
 *
 *   import { readOfflineSnapshot } from "@/lib/offline/db";
 *
 * keeping the same `OfflineSnapshot` contract (or importing theirs if it
 * matches). Nothing else in this file changes.
 */
type OfflineSnapshot = {
  /** Products in the cached catalogue. 0 means the till was never primed online. */
  catalogueSize: number;
  /** Sales taken offline and not yet pushed. This is money already collected. */
  pendingSales: number;
  /** Lease expiry, or null when no lease was ever stored on this device. */
  leaseExpiresAt: Date | null;
};

/**
 * Reads the device's own cache. Everything here comes from IndexedDB, never a
 * request: this component only ever renders when there is no network to make
 * one. A missing store is not an error — it means the till was never primed
 * while online, which the UI says plainly rather than failing.
 */
async function readSnapshot(): Promise<OfflineSnapshot | null> {
  try {
    const state = await loadOfflineState();
    if (!state.header) return null;
    const lease = await evaluateCachedLease(state.lease, state.publicKey);
    return {
      catalogueSize: state.products.length,
      // Counts anything not yet confirmed by the server, including sales parked
      // for review. Each one is cash already in the drawer, so the figure must
      // never undercount.
      pendingSales: state.pendingSales.filter((s) => s.status !== "synced").length,
      leaseExpiresAt: "expiresAt" in lease ? lease.expiresAt : null,
    };
  } catch {
    // A broken or blocked IndexedDB must not blank the till. Render the
    // never-primed state instead; the cashier still sees why they cannot sell.
    return null;
  }
}

export function OfflinePOSClient() {
  const isOffline = useOffline();
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readSnapshot().then((s) => {
      if (cancelled) return;
      setSnapshot(s);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) {
    return <p className="pos-offline-note">Opening the local till…</p>;
  }

  // No catalogue means this device never completed a sale online, so there is
  // nothing to sell from. Say that instead of showing an empty product grid,
  // which reads as "the shop has no stock".
  if (!snapshot || snapshot.catalogueSize === 0) {
    return (
      <p className="pos-offline-note">
        This device has no catalogue stored yet. Open a sale once while connected and the
        products, prices and your offline window are kept here for next time.
      </p>
    );
  }

  return (
    <div className="pos-offline-note">
      <p>
        {snapshot.catalogueSize} products available from this device.
        {snapshot.pendingSales > 0
          ? ` ${snapshot.pendingSales} sale(s) waiting to be sent.`
          : null}
      </p>
      {snapshot.leaseExpiresAt ? (
        <p>Offline selling allowed until {snapshot.leaseExpiresAt.toLocaleDateString()}.</p>
      ) : null}
      {!isOffline ? <p>Connection is back — reload to return to the live till.</p> : null}
    </div>
  );
}
