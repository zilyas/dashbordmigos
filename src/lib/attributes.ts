/**
 * Pure helpers for category attribute definitions and product attribute values
 * (Phase 2). No Prisma / no I/O — kept side-effect free so it is unit-testable
 * and shared by validation, actions and UI.
 *
 * Attribute values are stored as strings (`ProductAttributeValue.value`) and
 * coerced/validated per the definition's type here.
 */

export const ATTRIBUTE_TYPES = ["TEXT", "NUMBER", "BOOLEAN", "SELECT"] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export const ATTRIBUTE_TYPE_LABELS: Record<AttributeType, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  BOOLEAN: "Yes / No",
  SELECT: "Select (list)",
};

/** Safely reads a definition's `options` JSON into a string array. */
export function parseOptions(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

export type AttributeValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Validates and normalises a raw string value against a definition. An empty
 * value is allowed unless `required`. Returns the canonical stored form
 * (numbers stringified, booleans "true"/"false", select as-is).
 */
export function validateAttributeValue(
  type: AttributeType,
  raw: string,
  options: string[],
  required: boolean
): AttributeValidation {
  const v = raw.trim();
  if (v === "") {
    return required ? { ok: false, error: "This field is required." } : { ok: true, value: "" };
  }
  switch (type) {
    case "NUMBER": {
      const n = Number(v);
      if (!Number.isFinite(n)) return { ok: false, error: "Must be a number." };
      return { ok: true, value: String(n) };
    }
    case "BOOLEAN": {
      const low = v.toLowerCase();
      if (low === "true" || low === "false") return { ok: true, value: low };
      return { ok: false, error: "Must be true or false." };
    }
    case "SELECT": {
      if (!options.includes(v)) return { ok: false, error: "Not an allowed option." };
      return { ok: true, value: v };
    }
    case "TEXT":
    default:
      return { ok: true, value: v.slice(0, 500) };
  }
}

/** Human-readable display for a stored attribute value. */
export function formatAttributeValue(type: AttributeType, value: string): string {
  if (value === "") return "—";
  if (type === "BOOLEAN") return value === "true" ? "Yes" : "No";
  return value;
}
