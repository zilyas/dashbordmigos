/**
 * Pure helpers for custom variant axes (Phase 3). No Prisma / no I/O.
 *
 * Axis values are stored as a JSON map on `ProductVariant.axisValues`
 * (`{ [axisKey]: "value" }`). Unlike Phase 2 category attributes (typed, in a
 * relational table), these are simple free-text labels used only for variant
 * identification/display — so they need no per-type validation, just membership
 * in the store's defined axis keys.
 */

export type AxisRef = { key: string; label: string };

/** Safely coerces an `axisValues` JSON blob into a string map. */
export function parseAxisValues(value: unknown): Record<string, string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
      else if (v != null) out[k] = String(v);
    }
    return out;
  }
  return {};
}

/**
 * Returns axis values ordered by the axis definition list, dropping unknown
 * keys and empty values — for display and label building.
 */
export function orderedAxisValues(
  values: Record<string, string>,
  axes: AxisRef[]
): { key: string; label: string; value: string }[] {
  return axes
    .map((a) => ({ key: a.key, label: a.label, value: (values[a.key] ?? "").trim() }))
    .filter((a) => a.value.length > 0);
}

/** Just the ordered value strings (e.g. ["256GB", "Blue"]) for a variant label. */
export function axisValueList(values: Record<string, string>, axes: AxisRef[]): string[] {
  return orderedAxisValues(values, axes).map((a) => a.value);
}

/**
 * Validates submitted axis values against the store's allowed axis keys.
 * Unknown keys are rejected; values are trimmed/capped and empty ones dropped.
 */
export function validateAxisValues(
  values: Record<string, string>,
  allowedKeys: Set<string>
): { ok: true; cleaned: Record<string, string> } | { ok: false; error: string } {
  const cleaned: Record<string, string> = {};
  for (const [k, raw] of Object.entries(values)) {
    if (!allowedKeys.has(k)) return { ok: false, error: `Unknown variant axis "${k}".` };
    const v = (raw ?? "").trim().slice(0, 60);
    if (v) cleaned[k] = v;
  }
  return { ok: true, cleaned };
}
