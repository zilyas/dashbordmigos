/**
 * Pure, deterministic timezone + date-only helpers for expiry logic (Phase 4c1).
 *
 * No Prisma, no I/O, no browser APIs. All "today" calculations take an injected
 * `now` so they are testable, and all business comparisons happen on `YYYY-MM-DD`
 * date keys — never on server-local midnight, and never by shifting a date-only
 * value across a timezone. Expiry (`@db.Date`) is compared as a calendar date in
 * the store's configured IANA timezone.
 */

/** A short curated list for the settings select (any valid IANA id is accepted). */
export const COMMON_TIMEZONES = [
  "UTC",
  "Africa/Casablanca",
  "Africa/Algiers",
  "Africa/Cairo",
  "Africa/Lagos",
  "Europe/London",
  "Europe/Paris",
  "Europe/Madrid",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Tokyo",
] as const;

/** True for an IANA identifier the runtime's Intl actually supports. */
export function isValidIanaTimezone(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  // Reject fixed offsets like "+01:00" — DST rules make them wrong for dates.
  if (/^[+-]\d/.test(value.trim())) return false;
  try {
    // Throws RangeError for an unknown/invalid timezone.
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The calendar date (YYYY-MM-DD) that `date` falls on in `timezone`. Uses
 * `Intl` with the `en-CA` locale (which formats as ISO-like YYYY-MM-DD) so the
 * wall-clock date in the target zone is read correctly across DST and the date
 * line. Throws on an invalid timezone (never silently falls back to the server).
 */
export function getDateKeyInTimezone(date: Date, timezone: string): string {
  if (!isValidIanaTimezone(timezone)) {
    throw new RangeError(`Invalid IANA timezone: ${timezone}`);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** Today's date key (YYYY-MM-DD) in `timezone`. `now` is injectable for tests. */
export function getTodayInTimezone(timezone: string, now: Date = new Date()): string {
  return getDateKeyInTimezone(now, timezone);
}

/**
 * Normalizes a date-only value to its YYYY-MM-DD key WITHOUT timezone shifting.
 * A `@db.Date` column comes back as a Date at UTC midnight; reading its UTC
 * components (not local) preserves the stored calendar date. A string is trusted
 * to already be a date key (its first 10 chars).
 */
export function toDateKey(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Lexicographic compare of two date-only values (YYYY-MM-DD sorts correctly). */
export function compareDateOnly(a: Date | string, b: Date | string): number {
  const ka = toDateKey(a);
  const kb = toDateKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Expired = the batch's expiry calendar date is strictly BEFORE the store-local
 * today. A batch expiring *today* is NOT expired (sellable for the whole local
 * day). `storeToday` is a YYYY-MM-DD key from {@link getTodayInTimezone}.
 */
export function isExpiredOnDate(expiryDate: Date | string, storeToday: string): boolean {
  return toDateKey(expiryDate) < storeToday;
}

/**
 * Whole days from `storeToday` until `expiryDate` (negative if already past,
 * 0 if it expires today). Computed on UTC-midnight anchors of the date keys so
 * month/year boundaries and DST never distort the count.
 */
export function daysUntilExpiry(expiryDate: Date | string, storeToday: string): number {
  const [ey, em, ed] = toDateKey(expiryDate).split("-").map(Number);
  const [ty, tm, td] = storeToday.split("-").map(Number);
  const expiryMs = Date.UTC(ey, em - 1, ed);
  const todayMs = Date.UTC(ty, tm - 1, td);
  return Math.round((expiryMs - todayMs) / 86_400_000);
}
