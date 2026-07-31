export const DEFAULT_CURRENCY = "MAD";
export const APP_TIMEZONE = "Africa/Casablanca";

/**
 * Formats a fixed decimal amount and appends the currency code, e.g.
 * "1,234.00 MAD" — deliberately not `Intl.NumberFormat`'s built-in
 * `style: "currency"` (which would pick locale-specific symbol placement
 * and decimal/grouping conventions per currency); this keeps output
 * consistent and predictable across every currency a store might use.
 */
export function formatCurrency(value: number | string, currency = DEFAULT_CURRENCY) {
  const amount = typeof value === "string" ? Number(value) : value;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatted} ${currency}`;
}

export function formatNumber(value: number | string) {
  const amount = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat("en-US").format(amount);
}

export function formatPercent(value: number | string, fractionDigits = 1) {
  const amount = typeof value === "string" ? Number(value) : value;
  return `${amount.toFixed(fractionDigits)}%`;
}

export function formatDateTime(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: APP_TIMEZONE,
  }).format(date);
}

/** Time-only for today, short DD/MM date otherwise — for chat-style timestamps. */
export function formatChatTimestamp(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const isToday = new Date().toDateString() === date.toDateString();
  if (isToday) {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: APP_TIMEZONE,
    }).format(date);
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: APP_TIMEZONE,
  }).format(date);
}
