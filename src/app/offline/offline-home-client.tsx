"use client";

import { useCallback, useEffect, useState } from "react";
import type { OfflineConfig } from "@/lib/offline/db";
import { mergeRecentSales, type RecentSaleRow } from "@/lib/offline/recent-sales";
import { loadOfflineState, syncNow } from "@/lib/offline/sync";
import {
  formatMoney,
  formatPaymentMethod,
  formatSaleTime,
  pendingCount,
  saleBadge,
  saleLabel,
  syncFeedback,
  type SyncFeedback,
} from "./offline-home";

/**
 * The offline home screen's client half. Everything on screen comes from
 * IndexedDB, read here rather than in the page, because the page is precached
 * by the service worker and has no server to ask.
 *
 * No lease gate in this component, on purpose. An expired lease blocks SELLING
 * (POSTerminal enforces that); it must not block reading history or syncing a
 * queue, because the one action that fixes an expired lease is the sync this
 * screen offers. Gating here would strand a till with sales it could not upload.
 *
 * Nothing here deletes a pending sale. The list is capped at 10 rows by
 * mergeRecentSales, and a queued sale that falls off the bottom is still in the
 * queue — only syncNow()'s prune step may remove one, and only once a refreshed
 * snapshot proves the server has it.
 */

type Loaded = {
  config: OfflineConfig | null;
  rows: RecentSaleRow[];
  /** Last successful snapshot refresh — written only after a server round trip. */
  lastSyncAt: string | null;
};

export function OfflineHomeClient() {
  const [state, setState] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<SyncFeedback | null>(null);

  const read = useCallback(async (cancelled: () => boolean = () => false) => {
    try {
      const offline = await loadOfflineState();
      if (cancelled()) return;
      setState({
        config: offline.header?.config ?? null,
        // Reused wholesale: the merge, the 10-row cap, the newest-first order and
        // the de-duplication that stops a confirmed-but-unpruned sale appearing
        // twice all already live there and are unit-tested.
        rows: mergeRecentSales(offline.recentSales, offline.pendingSales),
        lastSyncAt: offline.header?.fetchedAt ?? null,
      });
      setFailed(false);
    } catch {
      if (cancelled()) return;
      // A blocked or broken IndexedDB must not blank the screen: the Open POS
      // link below is the one thing the cashier still needs, and it works
      // without any of this data.
      setFailed(true);
      setState({ config: null, rows: [], lastSyncAt: null });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Deferred into an async IIFE rather than awaited state in the effect body:
    // the first paint must not wait on IndexedDB, and the cancelled flag stops a
    // slow read writing state after the till navigated away.
    void (async () => {
      await read(() => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [read]);

  const onSync = useCallback(async () => {
    setSyncing(true);
    setFeedback(null);
    try {
      const summary = await syncNow();
      setFeedback(syncFeedback(summary));
      // Re-read either way: a partial run still changed statuses and invoice
      // numbers, and a stale list would contradict the message just shown.
      await read();
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error
            ? `Sync failed: ${error.message}. The sales are still saved on this device.`
            : "Sync failed. The sales are still saved on this device.",
      });
    } finally {
      setSyncing(false);
    }
  }, [read]);

  const currency = state?.config?.currency ?? "USD";
  const rows = state?.rows ?? [];
  const waiting = pendingCount(rows);

  return (
    <>
      <section className="offline-card">
        <div className="offline-card-head">
          <h2>Sync</h2>
          <button type="button" onClick={() => void onSync()} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync Now"}
          </button>
        </div>
        <p className="offline-muted">
          {waiting === 0
            ? "No sales waiting to upload."
            : `${waiting} sale${waiting === 1 ? "" : "s"} waiting to upload.`}
          {state?.lastSyncAt
            ? ` Last successful sync ${formatSaleTime(state.lastSyncAt)}.`
            : " This device has never synced."}
        </p>
        {feedback ? <p className={`offline-feedback tone-${feedback.tone}`}>{feedback.text}</p> : null}
        {failed ? (
          <p className="offline-feedback tone-error">
            This device&rsquo;s local storage could not be opened, so no history is shown. The till
            below may still work.
          </p>
        ) : null}
      </section>

      {/* A plain anchor, never a fetch or a server action: the worker precaches
          /offline/pos, so a hard navigation resolves from cache with no network
          while anything server-driven would hang. */}
      <a className="offline-cta" href="/offline/pos">
        Open POS
      </a>

      <section className="offline-card">
        <div className="offline-card-head">
          <h2>Last 10 sales</h2>
        </div>
        {state === null ? (
          <p className="offline-muted">Reading this device&rsquo;s records…</p>
        ) : rows.length === 0 ? (
          <p className="offline-muted">
            No sales stored on this device yet. Sales you ring up offline appear here and upload on
            the next sync.
          </p>
        ) : (
          <ul className="offline-sales">
            {rows.map((row) => {
              const badge = saleBadge(row.state);
              return (
                <li key={row.key}>
                  <div className="offline-sale-main">
                    <span className="offline-sale-id">{saleLabel(row)}</span>
                    <span className="offline-sale-total">{formatMoney(row.total, currency)}</span>
                  </div>
                  <div className="offline-sale-meta">
                    <span>{formatSaleTime(row.createdAt)}</span>
                    <span>{formatPaymentMethod(row.paymentMethod)}</span>
                    <span className={`offline-badge tone-${badge.tone}`}>{badge.label}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
