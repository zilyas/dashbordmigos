import { createHash } from "node:crypto";
import type { ApiOrderInput } from "@/lib/validations/api-order";
import type { SaleInput } from "@/lib/validations/sale";

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

/**
 * Same job as `hashOrderBody`, for an offline POS sale replayed through
 * `createSaleCore`.
 *
 * It fingerprints more than the order version does, because a till can get a
 * key wrong in more ways than a storefront can: `sellerId` is in the hash so
 * that a `clientSaleId` colliding across two cashiers on the same shared
 * device is a conflict rather than one cashier silently receiving the other's
 * sale, and `discountPercent`/`paymentMethod` are in it because a drawer that
 * took cash is not the same drawer entry as one that took card, even for an
 * identical basket. Items are sorted so a differently-serialised retry of the
 * same basket still counts as the same request.
 */
export function hashSaleBody(sellerId: string, input: SaleInput): string {
  const canonical = JSON.stringify({
    sellerId,
    customerName: input.customerName || null,
    customerPhone: input.customerPhone || null,
    discountPercent: input.discountPercent,
    paymentMethod: input.paymentMethod,
    items: input.items
      .map((i) => ({ productId: i.productId, variantId: i.variantId || null, quantity: i.quantity }))
      .sort(
        (a, b) =>
          a.productId.localeCompare(b.productId) ||
          (a.variantId ?? "").localeCompare(b.variantId ?? "") ||
          a.quantity - b.quantity
      ),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
