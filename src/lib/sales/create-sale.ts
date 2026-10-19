/**
 * Session-free sale creation. This is the body that `createSale()` in
 * `src/actions/sales.ts` used to hold inline.
 *
 * It was lifted out for the offline POS: a till that sold while the shop's
 * line was down replays its drawer through an HTTP route later, and a route
 * handler has none of what a `"use server"` action has — no `getSessionContext`,
 * no `requireStoreId`, no `revalidatePath`. So nothing session-bound may be
 * imported here; the caller passes `context` instead. The action is now a thin
 * wrapper that resolves the session, calls this, and flattens the rich result
 * back to the single `{ error }` string the POS renders.
 *
 * Error codes and the `{ ok }` discriminant deliberately follow
 * `src/lib/api/orders.ts` rather than inventing a second vocabulary — both are
 * machine-facing write paths into the same `sales` table.
 */
import { Prisma, type Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  decrementProductStock,
  decrementVariantStock,
  decrementBatchStock,
  decrementExpiredBatchStock,
} from "@/lib/inventory";
import { planExpiryAwareAllocation, reconcileBatchStock } from "@/lib/batches";
import { getTodayInTimezone } from "@/lib/timezone";
import {
  computeSaleTotals,
  formatInvoiceNumber,
  resolvePricing,
  round2,
  round3,
  isValidQuantity,
  variantLabel,
} from "@/lib/sale-math";
import { parseFeatures } from "@/lib/features";
import { parseAxisValues, axisValueList } from "@/lib/variant-axes";
import { hashSaleBody } from "@/lib/api/idempotency";
import { logActivity } from "@/lib/audit";
import { scopedLogger } from "@/lib/logger";
import { saleSchema, type SaleInput } from "@/lib/validations/sale";

const salesLogger = scopedLogger("app");

/** Thrown inside the sale transaction when an atomic stock decrement fails. */
export class InsufficientStock extends Error {
  constructor(
    readonly productName: string,
    readonly available: number
  ) {
    super("insufficient_stock");
  }
}

/** Thrown when a planned batch decrement loses a concurrency race (count !== 1). */
export class BatchAllocationConflict extends Error {
  constructor(readonly productName: string) {
    super("batch_allocation_conflict");
  }
}

/** Thrown when aggregate stock exists but non-expired batch stock is insufficient. */
export class InsufficientExpiryStock extends Error {
  constructor(readonly productName: string) {
    super("insufficient_expiry_stock");
  }
}

/**
 * Wrapper for anything this function did not anticipate. The caller needs the
 * original error AND the diagnostics the Sept 2026 incident proved we cannot
 * reconstruct after the fact (how many lines, what total) — see the
 * `logServerError` call in `src/actions/sales.ts`. `cause` carries the real
 * error so the action logs that, not this envelope.
 */
export class SaleCoreUnexpectedError extends Error {
  constructor(
    readonly cause: unknown,
    readonly diagnostics: { lineCount: number; total: number }
  ) {
    super("sale_core_unexpected");
  }
}

export type CreateSaleFailureCode =
  /** Caller sent something `saleSchema` refuses. */
  | "invalid_input"
  | "store_not_found"
  /** Signed-in user at a deactivated store. Closed Oct 2026 — see below. */
  | "store_inactive"
  | "product_unavailable"
  | "product_not_sellable"
  | "invalid_quantity"
  | "variant_required"
  | "variant_unavailable"
  | "insufficient_stock"
  | "insufficient_expiry_stock"
  /** Stock moved under us mid-transaction; a retry may well succeed. */
  | "stock_changed"
  /** Same `clientSaleId`, different body. The first sale is NOT returned. */
  | "idempotency_conflict"
  /** Offline total too far from the catalogue total to be a price change. */
  | "price_changed"
  | "invoice_contention";

export type CreateSaleResult =
  | {
      ok: true;
      /** True when this call returned a sale an earlier call already wrote. */
      replayed: boolean;
      saleId: string;
      invoiceNumber: string;
      total: number;
    }
  | {
      ok: false;
      code: CreateSaleFailureCode;
      /** Shop-floor text. The action returns this verbatim as `{ error }`. */
      message: string;
      /** Set on `price_changed`: what the catalogue says the basket costs now. */
      serverTotal?: number;
    };

export type CreateSaleContext = { userId: string; role: Role; storeId: string };

export type CreateSaleOptions = {
  /** Offline sales carry their real till time, not the time they synced. */
  createdAt?: Date;
  /** Till-generated uuid. Becomes `idempotencyKey` as `pos:<uuid>`. */
  clientSaleId?: string;
  /** What the cashier actually took at the drawer. */
  expectedTotal?: number;
  /** True only for the offline replay route. Gates the override below. */
  offline?: boolean;
};

const fail = (code: CreateSaleFailureCode, message: string, serverTotal?: number): CreateSaleResult => ({
  ok: false,
  code,
  message,
  ...(serverTotal !== undefined ? { serverTotal } : {}),
});

/**
 * How far an offline total may sit from today's catalogue total.
 *
 * The gap exists because time passed: the drawer was filled on Thursday and
 * the owner re-priced on Friday. Across the few days an offline queue can
 * survive, a real re-price in this market is a markup or markdown of a few
 * percent up to roughly a quarter — not a multiple. A till claiming 20 MAD
 * against a catalogue 240 is not a stale price, it is a cashier (or a tampered
 * payload) writing its own prices, and accepting it would turn the one place
 * where price comes from the database into a free-form price field.
 *
 * So: accept within +/-25%, refuse outside it and hand the caller
 * `serverTotal` so a manager reviews it by hand. Deliberately tight — a
 * refused sale is a phone call; an accepted theft is silent.
 */
const OFFLINE_TOTAL_TOLERANCE = 0.25;

/**
 * Reconciliation guard used inside sale/return/delete transactions: the
 * aggregate must equal the sum of a grain's batch stock across ALL statuses.
 * ARCHIVED and EXPIRED batches still hold physical stock (archiving/expiry
 * never zeroes it), so they count toward the total even though they're not
 * sellable. Throws if not.
 */
export async function assertGrainReconciled(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null
) {
  const batches = await tx.productBatch.findMany({
    where: { productId, variantId },
    select: { stock: true },
  });
  const aggregate = variantId
    ? Number((await tx.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { stock: true } })).stock)
    : Number((await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { stock: true } })).stock);
  const r = reconcileBatchStock(
    aggregate,
    batches.map((b) => ({ id: "", expiryDate: null, receivedAt: "", stock: Number(b.stock) }))
  );
  if (!r.reconciled) throw new Error(`batch reconciliation failed (${productId}/${variantId ?? "-"}: ${r.difference})`);
}

type SaleRow = { id: string; invoiceNumber: string; total: Prisma.Decimal | number; idempotencyHash: string | null };

const replaySuccess = (sale: SaleRow): CreateSaleResult => ({
  ok: true,
  replayed: true,
  saleId: sale.id,
  invoiceNumber: sale.invoiceNumber,
  total: Number(sale.total),
});

/**
 * Decides whether a stored key may be replayed for this body. Same rule as
 * `replayConflict` in `src/lib/api/orders.ts`: a null stored hash predates the
 * column and is accepted rather than failed, but a mismatch means the key was
 * already spent on a DIFFERENT basket — returning the first sale there would
 * drop the second one without a trace.
 */
function replayConflict(storedHash: string | null, bodyHash: string): CreateSaleResult | null {
  if (storedHash === null || storedHash === bodyHash) return null;
  return fail("idempotency_conflict", "This sale id was already used for a different sale. Use a new one.");
}

export async function createSaleCore(
  context: CreateSaleContext,
  input: SaleInput,
  options: CreateSaleOptions = {}
): Promise<CreateSaleResult> {
  const { storeId } = context;

  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", "Invalid sale data");
  const data = parsed.data;

  // `pos:` namespaces till-generated ids away from the storefront API's
  // caller-supplied keys, which share this column and its unique index.
  const idempotencyKey = options.clientSaleId ? `pos:${options.clientSaleId}` : null;
  const bodyHash = idempotencyKey ? hashSaleBody(context.userId, data) : null;

  if (idempotencyKey && bodyHash) {
    const existing = await prisma.sale.findUnique({
      where: { storeId_idempotencyKey: { storeId, idempotencyKey } },
      select: { id: true, invoiceNumber: true, total: true, idempotencyHash: true },
    });
    if (existing) {
      const conflict = replayConflict(existing.idempotencyHash, bodyHash);
      if (conflict) return conflict;
      return replaySuccess(existing);
    }
  }

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return fail("store_not_found", "Store not found");

  // Until Oct 2026 this path checked only that the store EXISTED. Deactivating
  // a store revoked nothing for anyone already signed in at its till — the
  // session outlives the status change, so the shop kept writing sales and
  // drawing down stock on a store the owner believed was closed. Refuse here;
  // the status is the authority, not the age of the cookie.
  if (store.status === "INACTIVE") {
    return fail("store_inactive", "This store is deactivated and cannot record sales.");
  }

  // De-duplicated: a cart legitimately holds several lines of the SAME product
  // when the buyer takes more than one variant of it (sweeter in S/M/L/XL is
  // four lines, one product). `findMany` returns that product once, so
  // comparing against the raw item count made every multi-variant sale fail
  // with "One or more products could not be found" — a real sale blocked by an
  // arithmetic mistake, not by missing data.
  const productIds = [...new Set(data.items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, storeId },
    include: {
      variants: { include: { size: { select: { name: true } }, color: { select: { name: true } } } },
    },
  });

  if (products.length !== productIds.length) {
    return fail("product_unavailable", "One or more products could not be found");
  }

  // Resolve every line to a concrete price, stock target (variant or product)
  // and a variant label snapshot. Variant-enabled products require a variant.
  const lines: {
    productId: string;
    productName: string;
    variantId: string | null;
    variantLabel: string | null;
    quantity: number;
    sellingPrice: number;
    fabricationPrice: number;
    availableStock: number;
    trackBatch: boolean;
    trackExpiry: boolean;
  }[] = [];

  const features = parseFeatures(store.features);
  const unitsEnabled = features.units_enabled;
  // Store-local "today" for expiry eligibility, resolved once per sale request.
  const storeToday = getTodayInTimezone(store.timezone);
  // Phase 5: Manager-only expired-stock override. A non-Manager session can never
  // enable it, regardless of the client flag (enforced from the session role).
  const expiredOverride = data.allowExpiredOverride === true && context.role === "MANAGER";
  // Store's custom axes (for building variant labels), only when enabled.
  const axisDefs = features.custom_variant_axes_enabled
    ? await prisma.variantAxisDefinition.findMany({
        where: { storeId, isActive: true },
        orderBy: [{ position: "asc" }, { label: "asc" }],
        select: { key: true, label: true },
      })
    : [];

  for (const item of data.items) {
    const product = products.find((p) => p.id === item.productId)!;

    // Expiry tracking is not active until Phase 4c — refuse to sell such a line.
    if (product.trackBatch && product.trackExpiry) {
      return fail("product_not_sellable", `Expiry tracking is not supported yet for "${product.name}".`);
    }

    // Decimal quantities are allowed only for decimal-enabled products in a
    // units-enabled store; otherwise the quantity must be a whole number.
    const allowDecimal = unitsEnabled && product.allowDecimalQuantity;
    if (!isValidQuantity(item.quantity, allowDecimal)) {
      return fail("invalid_quantity", `Quantity for "${product.name}" must be a whole number.`);
    }
    const quantity = round3(item.quantity);

    if (product.hasVariants) {
      if (!item.variantId) {
        return fail("variant_required", `Choose a variant for "${product.name}"`);
      }
      const variant = product.variants.find((v) => v.id === item.variantId);
      if (!variant || !variant.isActive) {
        return fail("variant_unavailable", `That variant of "${product.name}" is unavailable`);
      }
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
        variantLabel: variantLabel(
          variant.size?.name,
          variant.color?.name,
          axisValueList(parseAxisValues(variant.axisValues), axisDefs)
        ),
        quantity,
        sellingPrice: priced.sellingPrice,
        fabricationPrice: priced.fabricationPrice,
        availableStock: Number(variant.stock),
        trackBatch: product.trackBatch,
        trackExpiry: product.trackExpiry,
      });
    } else {
      lines.push({
        productId: product.id,
        productName: product.name,
        variantId: null,
        variantLabel: null,
        quantity,
        sellingPrice: Number(product.sellingPrice),
        fabricationPrice: Number(product.fabricationPrice),
        availableStock: Number(product.stock),
        trackBatch: product.trackBatch,
        trackExpiry: product.trackExpiry,
      });
    }
  }

  // Friendly pre-check; the atomic decrement inside the tx is the real guard.
  for (const line of lines) {
    if (line.availableStock < line.quantity) {
      return fail(
        "insufficient_stock",
        `Not enough stock for "${line.productName}" (${line.availableStock} available)`
      );
    }
  }

  const mathLines = lines.map((l) => ({
    sellingPrice: l.sellingPrice,
    fabricationPrice: l.fabricationPrice,
    quantity: l.quantity,
  }));
  const serverTotals = computeSaleTotals(mathLines, data.discountPercent, Number(store.taxRate));

  // ---------------------------------------------------------------------------
  // Offline price override. READ THIS BEFORE REUSING IT.
  //
  // Everywhere else in this codebase — this path, and `createApiOrder` in
  // src/lib/api/orders.ts — the unit price comes from the catalogue row and
  // NOTHING a client sends can move it. That is a security property, and this
  // block is the single, narrow hole in it.
  //
  // The hole is forced by physical cash. The till in Casablanca sold a bag for
  // 200 MAD on Thursday with the line down; the owner re-priced it to 240 on
  // Friday; the sale syncs on Saturday. The drawer holds 200. Record the
  // catalogue total and the books are 40 MAD richer than the shop, forever,
  // and the cashier is short at count-out for a price change she never saw.
  //
  // This is NOT a price parameter. It is gated three ways: `offline` is set
  // only by the offline-replay route (the action path never sets it, so the
  // online POS can never reach this), the gap must sit inside
  // OFFLINE_TOTAL_TOLERANCE, and BOTH figures go to the audit trail so a
  // manager sees the variance. Do not widen it, and do not plumb an
  // `expectedTotal` through the online path.
  // ---------------------------------------------------------------------------
  let totals = serverTotals;
  let chargedOverride: number | null = null;
  if (
    options.offline === true &&
    options.expectedTotal !== undefined &&
    round2(options.expectedTotal) !== serverTotals.total
  ) {
    const charged = round2(options.expectedTotal);
    const lower = serverTotals.total * (1 - OFFLINE_TOTAL_TOLERANCE);
    const upper = serverTotals.total * (1 + OFFLINE_TOTAL_TOLERANCE);
    if (charged <= 0 || serverTotals.subtotal <= 0 || charged < lower || charged > upper) {
      return fail(
        "price_changed",
        "The amount taken at the till is too far from the current catalogue price to post automatically.",
        serverTotals.total
      );
    }
    // Re-derive the whole money row from an effective discount rather than
    // overwriting `total` alone: subtotal/discount/tax/total/netProfit are read
    // directly by every revenue and profit aggregate in the app, and a `total`
    // that does not equal (subtotal - discount) + tax silently breaks all of
    // them. A charge ABOVE the catalogue total therefore lands as a negative
    // discount, i.e. a surcharge — which is exactly what it was.
    const taxRate = Number(store.taxRate) / 100;
    const effectiveDiscount = serverTotals.subtotal - charged / (1 + taxRate);
    totals = computeSaleTotals(mathLines, (effectiveDiscount / serverTotals.subtotal) * 100, Number(store.taxRate));
    chargedOverride = charged;
  }

  try {
    // Invoice numbers come from the atomic InvoiceSequence counter (same one
    // used by the API order path in src/lib/api/orders.ts), taken and advanced
    // in a single statement inside this transaction, so two concurrent sales
    // can't read the same next number the way a `sale.count() + 1` read-then-
    // write could. The retry loop below is now belt-and-braces against the
    // unique constraint rather than the expected path to a fresh number, but
    // it stays — the loop and the "couldn't assign an invoice number" fallback
    // are unchanged.
    const MAX_INVOICE_ATTEMPTS = 5;
    let sale: { id: string; invoiceNumber: string } | null = null;

    for (let attempt = 0; attempt < MAX_INVOICE_ATTEMPTS; attempt++) {
      try {
        sale = await prisma.$transaction(async (tx) => {
          // Phase 1: move stock. Every line decrements the aggregate atomically;
          // batch-tracked lines ALSO draw down FEFO batches by the same quantity
          // in the same transaction, so aggregate and batch stock never diverge.
          const lineAllocations = new Map<number, { batchId: string; quantity: number; fromExpired: boolean }[]>();
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const okAgg = line.variantId
              ? await decrementVariantStock(tx, line.variantId, line.quantity)
              : await decrementProductStock(tx, line.productId, line.quantity);
            if (!okAgg) throw new InsufficientStock(line.productName, line.availableStock);

            if (!line.trackBatch) continue;

            // Include EXPIRED batches in the candidate set only for a Manager
            // expired-override on a trackExpiry line; otherwise ACTIVE only.
            const includeExpired = line.trackExpiry && expiredOverride;
            const batches = await tx.productBatch.findMany({
              where: {
                storeId,
                productId: line.productId,
                variantId: line.variantId,
                status: includeExpired ? { in: ["ACTIVE", "EXPIRED"] } : "ACTIVE",
                stock: { gt: 0 },
              },
              orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
              select: { id: true, expiryDate: true, receivedAt: true, stock: true, status: true },
            });
            const mapped = batches.map((b) => ({
              id: b.id,
              expiryDate: b.expiryDate,
              receivedAt: b.receivedAt,
              stock: Number(b.stock),
              status: b.status,
            }));

            const alloc = planExpiryAwareAllocation(line.quantity, mapped, {
              trackExpiry: line.trackExpiry,
              storeToday,
              allowExpired: expiredOverride,
            });
            if (!alloc.ok) {
              if (line.trackExpiry) throw new InsufficientExpiryStock(line.productName);
              throw new InsufficientStock(line.productName, line.availableStock);
            }
            const allocations = alloc.allocations;

            for (const a of allocations) {
              const okBatch = a.fromExpired
                ? await decrementExpiredBatchStock(tx, a.batchId, a.quantity)
                : await decrementBatchStock(tx, a.batchId, a.quantity);
              if (!okBatch) throw new BatchAllocationConflict(line.productName);
              // Mark an ACTIVE batch DEPLETED once it hits exactly zero (an EXPIRED
              // batch drawn via override keeps EXPIRED status).
              await tx.productBatch.updateMany({
                where: { id: a.batchId, stock: 0, status: "ACTIVE" },
                data: { status: "DEPLETED" },
              });
            }
            lineAllocations.set(i, allocations);
          }

          // `create` covers a store's very first sale, when no counter row
          // exists yet — see InvoiceSequence in schema.prisma.
          const sequence = await tx.invoiceSequence.upsert({
            where: { storeId },
            create: { storeId, nextValue: 1 },
            update: { nextValue: { increment: 1 } },
            select: { nextValue: true },
          });
          const invoiceNumber = formatInvoiceNumber(sequence.nextValue);

          const created = await tx.sale.create({
            data: {
              invoiceNumber,
              sellerId: context.userId,
              customerName: data.customerName || null,
              customerPhone: data.customerPhone || null,
              subtotal: totals.subtotal,
              discount: totals.discount,
              tax: totals.tax,
              total: totals.total,
              netProfit: totals.netProfit,
              paymentMethod: data.paymentMethod,
              storeId,
              // The till's own clock, when it has one. An offline sale that
              // syncs on Saturday belongs in Thursday's takings, not
              // Saturday's; `@default(now())` would file it under the sync.
              ...(options.createdAt ? { createdAt: options.createdAt } : {}),
              ...(idempotencyKey ? { idempotencyKey, idempotencyHash: bodyHash } : {}),
            },
          });

          // Phase 2: create sale items, batch allocations, and inventory movements.
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const saleItem = await tx.saleItem.create({
              data: {
                saleId: created.id,
                productId: line.productId,
                variantId: line.variantId,
                variantLabel: line.variantLabel,
                quantity: line.quantity,
                sellingPrice: line.sellingPrice,
                fabricationPrice: line.fabricationPrice,
                profit: round2((line.sellingPrice - line.fabricationPrice) * line.quantity),
              },
            });

            const allocs = lineAllocations.get(i);
            if (allocs && allocs.length > 0) {
              const sum = round3(allocs.reduce((s, a) => s + a.quantity, 0));
              if (sum !== round3(line.quantity)) throw new BatchAllocationConflict(line.productName);
              for (const a of allocs) {
                await tx.saleItemBatchAllocation.create({
                  data: { saleItemId: saleItem.id, batchId: a.batchId, quantity: a.quantity, fromExpired: a.fromExpired },
                });
                await tx.inventoryMovement.create({
                  data: {
                    storeId,
                    productId: line.productId,
                    variantId: line.variantId,
                    batchId: a.batchId,
                    type: "OUT",
                    quantity: -a.quantity,
                    note: a.fromExpired
                      ? `Sold on invoice ${invoiceNumber} — EXPIRED stock (manager override)`
                      : `Sold on invoice ${invoiceNumber}`,
                    createdById: context.userId,
                  },
                });
                if (a.fromExpired) {
                  // Dedicated, per-batch audit trail for the exceptional override.
                  await logActivity(
                    {
                      storeId,
                      userId: context.userId,
                      action: "sale.expiredOverrideUsed",
                      entity: "Sale",
                      entityId: created.id,
                      metadata: { invoiceNumber, productName: line.productName, batchId: a.batchId, quantity: a.quantity },
                    },
                    tx
                  );
                }
              }
              await assertGrainReconciled(tx, line.productId, line.variantId);
            } else {
              await tx.inventoryMovement.create({
                data: {
                  storeId,
                  productId: line.productId,
                  variantId: line.variantId,
                  type: "OUT",
                  quantity: -line.quantity,
                  note: `Sold on invoice ${invoiceNumber}`,
                  createdById: context.userId,
                },
              });
            }
          }

          await logActivity(
            {
              storeId,
              userId: context.userId,
              action: "sale.created",
              entity: "Sale",
              entityId: created.id,
              metadata: {
                invoiceNumber,
                total: totals.total,
                ...(idempotencyKey ? { idempotencyKey } : {}),
                ...(options.offline ? { offline: true } : {}),
                // Both figures, so a manager can see the variance: `sales` has
                // no column for a second total and one offline edge case does
                // not earn a migration. `chargedTotal` is what the drawer holds
                // (and what `total` was written as); `catalogueTotal` is what
                // today's prices say it should have been.
                ...(chargedOverride !== null
                  ? {
                      priceOverride: {
                        chargedTotal: chargedOverride,
                        catalogueTotal: serverTotals.total,
                        variance: round2(chargedOverride - serverTotals.total),
                      },
                    }
                  : {}),
              },
            },
            tx
          );

          return created;
        });
        break;
      } catch (error) {
        if (error instanceof InsufficientStock) {
          return fail(
            "insufficient_stock",
            `Not enough stock for "${error.productName}" (${error.available} available)`
          );
        }
        if (error instanceof BatchAllocationConflict) {
          return fail("stock_changed", `Stock for "${error.productName}" changed mid-sale — please try again.`);
        }
        if (error instanceof InsufficientExpiryStock) {
          return fail("insufficient_expiry_stock", `Insufficient non-expired stock for "${error.productName}".`);
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          // Two tills (or a till and its own retry) replaying the same
          // clientSaleId at once: the loser reads the winner's row instead of
          // erroring, so one drawer entry posts exactly one sale.
          if (idempotencyKey && bodyHash && String(error.meta?.target ?? "").includes("idempotencyKey")) {
            const winner = await prisma.sale.findUnique({
              where: { storeId_idempotencyKey: { storeId, idempotencyKey } },
              select: { id: true, invoiceNumber: true, total: true, idempotencyHash: true },
            });
            if (winner) return replayConflict(winner.idempotencyHash, bodyHash) ?? replaySuccess(winner);
          }
          if (attempt < MAX_INVOICE_ATTEMPTS - 1) continue;
        }
        throw error;
      }
    }

    if (!sale) return fail("invoice_contention", "Could not assign an invoice number. Please try again.");

    // Low-stock notifications, best-effort — do not fail the sale if this errors.
    try {
      const updatedProducts = await prisma.product.findMany({
        where: { id: { in: productIds } },
      });
      const lowStock = updatedProducts.filter((p) => Number(p.stock) <= Number(p.minimumStock));
      if (lowStock.length > 0) {
        const recipients = await prisma.user.findMany({
          where: { storeId, role: "MANAGER", status: "ACTIVE" },
          select: { id: true },
        });
        await prisma.notification.createMany({
          data: lowStock.flatMap((p) =>
            recipients.map((r) => ({
              storeId,
              userId: r.id,
              type: "LOW_STOCK" as const,
              title: "Low stock alert",
              message: `${p.name} (${p.sku}) is at ${p.stock} units, below the minimum of ${p.minimumStock}.`,
            }))
          ),
        });
      }
    } catch (error) {
      // Notifications are genuinely non-critical — the sale is already
      // committed and must not be failed for this. But `warn` rather than
      // silence: a manager who stops getting low-stock alerts has no other
      // signal that this block has been throwing for weeks.
      salesLogger.warn(
        { err: error, action: "sale.lowStockNotify", storeId, saleId: sale.id },
        "low-stock notification failed"
      );
    }

    return { ok: true, replayed: false, saleId: sale.id, invoiceNumber: sale.invoiceNumber, total: totals.total };
  } catch (error) {
    // Everything unanticipated leaves wrapped, carrying the diagnostics the
    // caller cannot rebuild afterwards (the Sept 2026 incident was undiagnosable
    // precisely because they were lost). The caller decides what gets logged and
    // what the shop floor is allowed to see.
    throw new SaleCoreUnexpectedError(error, { lineCount: lines.length, total: totals.total });
  }
}
