import { createHash } from "node:crypto";
import type { ApiOrderInput } from "@/lib/validations/api-order";

/**
 * Fingerprints the meaningful content of an order body.
 *
 * `idempotencyKey` alone cannot tell a retry apart from a mistake. A storefront
 * that reuses a key — a hard-coded value, a cart id recycled after the customer
 * edited the basket, a buggy queue — would otherwise get 200 with the FIRST
 * order's totals and never learn that its second, different order was dropped.
 * Storing this hash next to the key lets the replay path answer "same request"
 * instead of only "same key".
 *
 * The key itself is excluded (it is the lookup, not the content). Items are
 * sorted so that a storefront which serialises its basket in a different order
 * on the retry still counts as the same request.
 */
export function hashOrderBody(input: ApiOrderInput): string {
  const canonical = JSON.stringify({
    customerName: input.customerName ?? null,
    customerPhone: input.customerPhone ?? null,
    items: input.items
      .map((i) => ({ productId: i.productId, variantId: i.variantId ?? null, quantity: i.quantity }))
      .sort(
        (a, b) =>
          a.productId.localeCompare(b.productId) ||
          (a.variantId ?? "").localeCompare(b.variantId ?? "") ||
          a.quantity - b.quantity
      ),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
