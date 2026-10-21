/**
 * Pure decisions for the offline home screen (./offline-home-client.tsx).
 *
 * Split out for one reason: the client component cannot be unit-tested without
 * a DOM and an IndexedDB, and this project forbids tests that assert on markup.
 * The two things that can actually be WRONG here — a queued sale shown as
 * "Synced", and a failed sync reported as a success — are both decided in this
 * file, so both are covered by ./offline-home.test.ts.
 *
 * No IndexedDB, no fetch, no React in here.
 */
import type { SyncSummary } from "@/lib/offline/sync";
import type { RecentSaleRow } from "@/lib/offline/recent-sales";

export type SaleBadge = { label: string; tone: "pending" | "synced" | "review" };

/**
 * The marker on a sale row. `review` must never collapse into `pending`: a
 * review sale was rejected by the server and needs a human, while a pending one
 * only needs the network back. Telling the cashier to "wait" on a sale that
 * will never upload by itself is how a sale silently goes missing from the books.
 */
export function saleBadge(state: RecentSaleRow["state"]): SaleBadge {
  switch (state) {
    case "synced":
      return { label: "Synced", tone: "synced" };
    case "review":
      return { label: "Needs Review", tone: "review" };
    default:
      return { label: "Pending Sync", tone: "pending" };
  }
}

export type SyncFeedback = { tone: "ok" | "warn" | "error"; text: string };

/**
 * What the Sync Now button reports afterwards.
 *
 * `syncNow()` resolves even when nothing was sent — offline, signed out, or a
 * failed snapshot refresh all come back as a resolved summary with `stopped`
 * set. Always claiming success here would leave a cashier believing the queue
 * is empty while the sales are still only on this device.
 */
export function syncFeedback(summary: SyncSummary): SyncFeedback {
  if (summary.stopped) {
    return {
      tone: "error",
      text: summary.message ?? "Sync could not finish. The sales are still saved on this device.",
    };
  }
  if (!summary.ran) {
    return { tone: "warn", text: "A sync is already running. Give it a moment." };
  }

  const sent = summary.uploaded + summary.replayed;
  const parts: string[] = [];
  if (sent > 0) parts.push(`${sent} sale${sent === 1 ? "" : "s"} sent`);
  // Surfaced even on an otherwise clean run: these two need a person, and the
  // only place the cashier would otherwise notice is the badge on a row.
  if (summary.review > 0) parts.push(`${summary.review} need review`);
  if (summary.retry > 0) parts.push(`${summary.retry} will retry`);

  if (parts.length === 0) return { tone: "ok", text: "Everything is already synced." };
  return {
    tone: summary.review > 0 || summary.retry > 0 ? "warn" : "ok",
    text: `${parts.join(", ")}.`,
  };
}

/** Rows still owed to the server. `synced` rows are only waiting to be pruned. */
export function pendingCount(rows: readonly RecentSaleRow[]): number {
  return rows.filter((row) => row.state !== "synced").length;
}

/**
 * Locale-formatted date and time for a row, and the money beside it.
 *
 * Both tolerate junk rather than throwing: these render a cached record on a
 * till with no network, and a blank screen from one bad timestamp is a worse
 * outcome than a row reading "—".
 */
export function formatSaleTime(iso: string, locale?: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";
  return new Date(parsed).toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatMoney(amount: number, currency: string, locale?: string): string {
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    // A currency code the snapshot carried but Intl rejects must not blank the
    // list; fall back to the raw code so the figure stays readable.
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Human label for the stored payment method enum. */
export function formatPaymentMethod(method: string): string {
  if (!method) return "—";
  return method.charAt(0) + method.slice(1).toLowerCase();
}

/**
 * What identifies a sale in the list. Prefer the invoice number, because that
 * is the number on the customer's receipt and the only one they can quote. A
 * queued sale has none yet — the server issues it — so fall back to a short
 * form of the id rather than printing nothing and leaving two unidentifiable
 * rows side by side.
 */
export function saleLabel(row: Pick<RecentSaleRow, "invoiceNumber" | "clientSaleId" | "saleId">): string {
  if (row.invoiceNumber) return row.invoiceNumber;
  const id = row.clientSaleId ?? row.saleId;
  return id ? `Queued · ${id.slice(0, 8)}` : "Queued sale";
}
