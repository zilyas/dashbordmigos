/**
 * Order ingestion for external storefronts. This is the write path behind
 * `POST /api/v1/orders`.
 *
 * It intentionally does NOT reuse `createSale()` from `src/actions/sales.ts`:
 * that function is session-bound end to end (`getSessionContext`, `can()`,
 * `requireStoreId`, `revalidatePath`) and a machine caller has none of those.
 * What IS reused is the part that matters for correctness — the atomic
 * `decrementProductStock` / `decrementVariantStock` guards in
 * `src/lib/inventory.ts`, which put the `stock >= quantity` test inside the
 * UPDATE so two concurrent orders can never both pass and drive stock negative.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decrementProductStock, decrementVariantStock } from "@/lib/inventory";
import {
  computeSaleTotals,
  formatInvoiceNumber,
  isValidQuantity,
  resolvePricing,
  round2,
  round3,
  variantLabel,
} from "@/lib/sale-math";
import { parseFeatures } from "@/lib/features";
import { logActivity } from "@/lib/audit";
import type { ApiClientContext } from "@/lib/api/auth";
import type { ApiOrderInput } from "@/lib/validations/api-order";

class InsufficientStock extends Error {
  constructor(
    readonly productName: string,
    readonly available: number
  ) {
    super("insufficient stock");
  }
}

export type OrderResult =
  | { ok: true; replayed: boolean; sale: { id: string; invoiceNumber: string; total: number; createdAt: Date } }
  | { ok: false; status: number; code: string; message: string };

function toSummary(sale: { id: string; invoiceNumber: string; total: Prisma.Decimal | number; createdAt: Date }) {
  return {
    id: sale.id,
    invoiceNumber: sale.invoiceNumber,
    total: Number(sale.total),
    createdAt: sale.createdAt,
  };
}

/**
 * Creates one sale from an external order, decrementing central inventory.
 *
 * Idempotency: `idempotencyKey` is unique per store. A retried webhook replays
 * the same key, hits the pre-check or the P2002 below, and gets the ORIGINAL
 * sale back — stock is decremented exactly once no matter how many times the
 * storefront retries a request whose response it never saw.
 */
export async function createApiOrder(context: ApiClientContext, input: ApiOrderInput): Promise<OrderResult> {
  const { storeId, actorUserId, clientId } = context;
  // A key holding only `orders:create` must not learn catalogue names or exact
  // stock levels from error messages: probing a 409 with quantity 999999 writes
  // nothing, so it is a free, repeatable read of the products:read / stock:read
  // surface. Fall back to the caller's own input when the scope is absent.
  const showNames = context.scopes.includes("products:read");
  const showStock = context.scopes.includes("stock:read");
  const label = (id: string, name: string) => (showNames ? `"${name}"` : `product ${id}`);

  const existing = await prisma.sale.findUnique({
    where: { storeId_idempotencyKey: { storeId, idempotencyKey: input.idempotencyKey } },
    select: { id: true, invoiceNumber: true, total: true, createdAt: true },
  });
  if (existing) return { ok: true, replayed: true, sale: toSummary(existing) };

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return { ok: false, status: 404, code: "store_not_found", message: "Store not found." };

  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    // `status: ACTIVE` is NOT optional here. `createSale` omits it because the
    // POS only ever offers active products; an API caller can name any id, so
    // DRAFT and ARCHIVED products must be unsellable at this boundary.
    where: { id: { in: productIds }, storeId, status: "ACTIVE" },
    include: { variants: { include: { size: { select: { name: true } }, color: { select: { name: true } } } } },
  });

  const unitsEnabled = parseFeatures(store.features).units_enabled;

  const lines: {
    productId: string;
    productName: string;
    variantId: string | null;
    variantLabel: string | null;
    quantity: number;
    sellingPrice: number;
    fabricationPrice: number;
    availableStock: number;
  }[] = [];

  for (const item of input.items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) {
      // 404, not 422: the body was well-formed, the product just is not in this
      // key's store (or is not ACTIVE). A storefront treats this as "delist it".
      return {
        ok: false,
        status: 404,
        code: "product_unavailable",
        message: `Product ${item.productId} is not available for sale.`,
      };
    }
    // Batch/FEFO allocation is a separate code path with its own reconciliation
    // invariants (see assertGrainReconciled in src/actions/sales.ts). Rather than
    // duplicate it half-correctly, the API refuses these products outright.
    // ponytail: batch-tracked products are API-unsellable — add FEFO allocation
    // here when a store actually turns trackBatch on for a web-sold product.
    if (product.trackBatch) {
      return {
        ok: false,
        status: 422,
        code: "product_not_api_sellable",
        message: `${label(product.id, product.name)} is batch-tracked and cannot be sold through the API yet.`,
      };
    }

    const allowDecimal = unitsEnabled && product.allowDecimalQuantity;
    if (!isValidQuantity(item.quantity, allowDecimal)) {
      return {
        ok: false,
        status: 422,
        code: "invalid_quantity",
        message: `Quantity for ${label(product.id, product.name)} must be a whole number.`,
      };
    }
    const quantity = round3(item.quantity);

    if (product.hasVariants) {
      if (!item.variantId) {
        return {
          ok: false,
          status: 422,
          code: "variant_required",
          message: `${label(product.id, product.name)} requires a variantId.`,
        };
      }
      const variant = product.variants.find((v) => v.id === item.variantId);
      if (!variant || !variant.isActive) {
        return {
          ok: false,
          status: 404,
          code: "variant_unavailable",
          message: `That variant of ${label(product.id, product.name)} is unavailable.`,
        };
      }
      // Price always comes from the database row, never from the request body —
      // there is no price or discount field in ApiOrderInput to tamper with.
      const priced = resolvePricing(
        { sellingPrice: Number(product.sellingPrice), fabricationPrice: Number(product.fabricationPrice) },
        {
          sellingPrice: variant.sellingPrice != null ? Number(variant.sellingPrice) : null,
          fabricationPrice: variant.fabricationPrice != null ? Number(variant.fabricationPrice) : null,
        }
      );
      lines.push({
        productId: product.id,
        productName: product.name,
        variantId: variant.id,
        variantLabel: variantLabel(variant.size?.name, variant.color?.name),
        quantity,
        sellingPrice: priced.sellingPrice,
        fabricationPrice: priced.fabricationPrice,
        availableStock: Number(variant.stock),
      });
    } else {
      if (item.variantId) {
        return {
          ok: false,
          status: 422,
          code: "variant_not_applicable",
          message: `${label(product.id, product.name)} has no variants.`,
        };
      }
      lines.push({
        productId: product.id,
        productName: product.name,
        variantId: null,
        variantLabel: null,
        quantity,
        sellingPrice: Number(product.sellingPrice),
        fabricationPrice: Number(product.fabricationPrice),
        availableStock: Number(product.stock),
      });
    }
  }

  // Friendly pre-check only; the guard inside the transaction is the real one.
  for (const line of lines) {
    if (line.availableStock < line.quantity) {
      return {
        ok: false,
        status: 409,
        code: "insufficient_stock",
        message: `Not enough stock for ${label(line.productId, line.productName)}${showStock ? ` (${line.availableStock} available)` : ""}.`,
      };
    }
  }

  // No discount: the storefront prices its own basket, but the money recorded
  // centrally is always derived from our own catalog prices plus the store tax.
  const totals = computeSaleTotals(lines, 0, Number(store.taxRate));

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        for (const line of lines) {
          const ok = line.variantId
            ? await decrementVariantStock(tx, line.variantId, line.quantity)
            : await decrementProductStock(tx, line.productId, line.quantity);
          if (!ok) throw new InsufficientStock(line.productName, line.availableStock);
        }

        const count = await tx.sale.count({ where: { storeId } });
        const invoiceNumber = formatInvoiceNumber(count + 1);

        const sale = await tx.sale.create({
          data: {
            invoiceNumber,
            storeId,
            // Non-nullable FK: the key carries its own actor precisely because a
            // machine caller has no session (same shape as the cron routes).
            sellerId: actorUserId,
            apiClientId: clientId,
            idempotencyKey: input.idempotencyKey,
            customerName: input.customerName || null,
            customerPhone: input.customerPhone || null,
            subtotal: totals.subtotal,
            discount: totals.discount,
            tax: totals.tax,
            total: totals.total,
            netProfit: totals.netProfit,
            paymentMethod: "OTHER",
          },
        });

        for (const line of lines) {
          await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: line.productId,
              variantId: line.variantId,
              variantLabel: line.variantLabel,
              quantity: line.quantity,
              sellingPrice: line.sellingPrice,
              fabricationPrice: line.fabricationPrice,
              profit: round2((line.sellingPrice - line.fabricationPrice) * line.quantity),
            },
          });
          await tx.inventoryMovement.create({
            data: {
              storeId,
              productId: line.productId,
              variantId: line.variantId,
              type: "OUT",
              quantity: -line.quantity,
              note: `Online order ${invoiceNumber} (API)`,
              createdById: actorUserId,
            },
          });
        }

        await logActivity(
          {
            storeId,
            userId: actorUserId,
            action: "api.order.created",
            entity: "Sale",
            entityId: sale.id,
            metadata: {
              invoiceNumber,
              total: totals.total,
              apiClientId: clientId,
              idempotencyKey: input.idempotencyKey,
            },
          },
          tx
        );

        return sale;
      });

      return { ok: true, replayed: false, sale: toSummary(created) };
    } catch (error) {
      if (error instanceof InsufficientStock) {
        return {
          ok: false,
          status: 409,
          code: "insufficient_stock",
          message: `Not enough stock for "${error.productName}" (${error.available} available).`,
        };
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = String(error.meta?.target ?? "");
        // Two concurrent replays of the same idempotency key: the loser reads
        // the winner's row instead of erroring.
        if (target.includes("idempotencyKey")) {
          const winner = await prisma.sale.findUnique({
            where: { storeId_idempotencyKey: { storeId, idempotencyKey: input.idempotencyKey } },
            select: { id: true, invoiceNumber: true, total: true, createdAt: true },
          });
          if (winner) return { ok: true, replayed: true, sale: toSummary(winner) };
        }
        // Invoice-number collision under concurrency — retry the whole atomic
        // transaction so the loser re-derives the next free number.
        if (attempt < MAX_ATTEMPTS - 1) continue;
      }
      throw error;
    }
  }

  return {
    ok: false,
    status: 503,
    code: "invoice_contention",
    message: "Could not assign an invoice number. Retry with the same idempotencyKey.",
  };
}
