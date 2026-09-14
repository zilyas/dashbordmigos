/**
 * Accent- and case-insensitive text helpers for search. French (and Latin
 * scripts generally) use combining accents that NFD splits off so we can strip
 * them — "Crème" matches "creme", "Noël" matches "noel". Non-Latin scripts are
 * left as-is beyond lower-casing.
 */
// U+0300–U+036F is the Unicode "combining diacritical marks" block.
const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalize(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase().trim();
}

/** True when `query` is an accent-insensitive substring of `haystack`. */
export function matchesQuery(haystack: string | null | undefined, query: string): boolean {
  if (!haystack) return false;
  return normalize(haystack).includes(normalize(query));
}

/** True when `query` matches any of the provided fields. */
export function matchesAny(fields: (string | null | undefined)[], query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return fields.some((f) => (f ? normalize(f).includes(q) : false));
}
