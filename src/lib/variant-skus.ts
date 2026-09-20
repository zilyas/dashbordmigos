import { slugify } from "@/lib/utils";

/**
 * SKU for a generated variant, e.g. ("TSHIRT", ["M", "Navy Blue"]) ->
 * "TSHIRT-M-NAVY-BLUE". `parts` are the axis labels that tell this variant
 * apart from its siblings, in display order (size then color).
 *
 * `taken` holds the SKUs already used, so two labels that slugify to the same
 * thing ("Blue" / "blue") do not collide with each other or with an existing
 * row under @@unique([storeId, sku]).
 *
 * Capped at 40 characters to match `variantSchema.sku`; the suffix is kept and
 * the base is trimmed, because the axis labels are what identify the variant.
 */
export function variantSku(baseSku: string, parts: string[], taken: Set<string>): string {
  const suffix = parts.map((p) => slugify(p).toUpperCase()).filter(Boolean).join("-") || "VAR";
  const build = (n: number) => {
    const tail = n === 1 ? `-${suffix}` : `-${suffix}-${n}`;
    return `${baseSku.slice(0, Math.max(1, 40 - tail.length))}${tail}`;
  };
  let n = 1;
  let sku = build(n);
  while (taken.has(sku)) sku = build(++n);
  taken.add(sku);
  return sku;
}
