import { slugify } from "@/lib/utils";

/**
 * SKU for the variant generated from a picked color, e.g. ("TSHIRT", "Navy
 * Blue") -> "TSHIRT-NAVY-BLUE". `taken` holds the SKUs already used, so two
 * colors that slugify to the same thing ("Blue" / "blue") do not collide with
 * each other or with an existing row under @@unique([storeId, sku]).
 *
 * Capped at 40 characters to match `variantSchema.sku`; the suffix is kept and
 * the base is trimmed, because the color is what tells the two variants apart.
 */
export function colorVariantSku(baseSku: string, colorName: string, taken: Set<string>): string {
  const suffix = slugify(colorName).toUpperCase() || "COLOR";
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
