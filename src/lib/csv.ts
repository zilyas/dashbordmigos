/**
 * CSV cell escaping for report exports.
 *
 * Two concerns are handled here:
 *  1. Structural escaping — wrap in quotes and double any embedded quotes when a
 *     value contains a quote, comma, or newline (standard RFC 4180 behaviour).
 *  2. Formula-injection hardening — a text cell that begins with `=`, `+`, `-`,
 *     or `@` is interpreted as a formula by Excel / Google Sheets / LibreOffice.
 *     A crafted report value like `=HYPERLINK(...)` or `=cmd|...` could execute
 *     on open, so such text cells are prefixed with a single quote `'`, which
 *     forces the spreadsheet to treat the whole cell as literal text.
 *
 * Numeric values are never neutralised: a real `number` (e.g. a negative profit
 * of `-5`) cannot carry a formula payload, and prefixing it would corrupt the
 * cell into text. Injection can only arrive through string content.
 */

const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@"]);

function needsFormulaGuard(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.length > 0 && FORMULA_TRIGGERS.has(trimmed[0]);
}

export function csvEscape(value: string | number): string {
  const str = String(value);
  const guarded = typeof value === "string" && needsFormulaGuard(str) ? `'${str}` : str;
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
