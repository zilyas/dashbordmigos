"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { logActivity } from "@/lib/audit";
import {
  decrementProductStock,
  decrementVariantStock,
  incrementProductStock,
  incrementVariantStock,
  decrementBatchStock,
  decrementExpiredBatchStock,
  incrementBatchStock,
} from "@/lib/inventory";
import {
  planExpiryAwareAllocation,
  planReturnRestoration,
  planDeletionRestoration,
  reconcileBatchStock,
} from "@/lib/batches";
import { getTodayInTimezone, toDateKey } from "@/lib/timezone";
import {
  computeSaleTotals,
  computeReturnAmounts,
  formatInvoiceNumber,
  resolvePricing,
  round2,
  round3,
  isValidQuantity,
  variantLabel,
} from "@/lib/sale-math";
import { parseFeatures, getStoreFeatures } from "@/lib/features";
import { parseAxisValues, axisValueList } from "@/lib/variant-axes";
import {
  saleSchema,
  saleReturnSchema,
  saleDetailsSchema,
  type SaleInput,
  type SaleReturnInput,
  type SaleDetailsInput,
} from "@/lib/validations/sale";

/** Thrown inside the sale transaction when an atomic stock decrement fails. */
class InsufficientStock extends Error {
  constructor(
    readonly productName: string,
    readonly available: number
  ) {
    super("insufficient_stock");
  }
}

/** Thrown when a planned batch decrement loses a concurrency race (count !== 1). */
class BatchAllocationConflict extends Error {
  constructor(readonly productName: string) {
    super("batch_allocation_conflict");
  }
}

/** Thrown when aggregate stock exists but non-expired batch stock is insufficient. */
class InsufficientExpiryStock extends Error {
  constructor(readonly productName: string) {
    super("insufficient_expiry_stock");
  }
}

/** Thrown when a tracked SaleItem's batch allocation history is missing/inconsistent. */
class AllocationIntegrityError extends Error {
  constructor(readonly productName: string) {
    super("allocation_integrity");
  }
}

/**
 * After restoring stock to a batch (return/deletion), fix its status:
 * a DEPLETED batch comes back to ACTIVE only when NOT expired (null date or
 * date >= store-local today); an expired DEPLETED batch becomes EXPIRED so the
 * returned units stay non-sellable. ACTIVE/EXPIRED/ARCHIVED are left untouched.
 * Null-date (batch-only) batches always revive to ACTIVE — unchanged behavior.
 */
async function reviveRestoredBatch(
  tx: Prisma.TransactionClient,
  batchId: string,
  storeToday: string
) {
  const cutoff = new Date(storeToday + "T00:00:00.000Z");
  await tx.productBatch.updateMany({
    where: { id: batchId, status: "DEPLETED", OR: [{ expiryDate: null }, { expiryDate: { gte: cutoff } }] },
    data: { status: "ACTIVE" },
  });
  await tx.productBatch.updateMany({
    where: { id: batchId, status: "DEPLETED", expiryDate: { lt: cutoff } },
    data: { status: "EXPIRED" },
  });
}

/**
 * Reconciliation guard used inside sale/return/delete transactions: the aggregate
 * must equal the sum of a grain's batch stock across ALL statuses. ARCHIVED and
 * EXPIRED batches still hold physical stock (archiving/expiry never zeroes it),
 * so they count toward the total even though they're not sellable. Throws if not.
 */
async function assertGrainReconciled(
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

export async function createSale(input: SaleInput) {
  const context = await getSessionContext();
  if (!context || !can(context.role, "sale.create")) {
    return { error: "Not authorized" };
  }
  const storeId = requireStoreId(context);

  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid sale data" };
  const data = parsed.data;

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return { error: "Store not found" };

  const productIds = data.items.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, storeId },
    include: {
      variants: { include: { size: { select: { name: true } }, color: { select: { name: true } } } },
    },
  });

  if (products.length !== productIds.length) {
    return { error: "One or more products could not be found" };
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
      return { error: `Expiry tracking is not supported yet for "${product.name}".` };
    }

    // Decimal quantities are allowed only for decimal-enabled products in a
    // units-enabled store; otherwise the quantity must be a whole number.
    const allowDecimal = unitsEnabled && product.allowDecimalQuantity;
    if (!isValidQuantity(item.quantity, allowDecimal)) {
      return { error: `Quantity for "${product.name}" must be a whole number.` };
    }
    const quantity = round3(item.quantity);

    if (product.hasVariants) {
      if (!item.variantId) {
        return { error: `Choose a variant for "${product.name}"` };
      }
      const variant = product.variants.find((v) => v.id === item.variantId);
      if (!variant || !variant.isActive) {
        return { error: `That variant of "${product.name}" is unavailable` };
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
      return { error: `Not enough stock for "${line.productName}" (${line.availableStock} available)` };
    }
  }

  const totals = computeSaleTotals(
    lines.map((l) => ({ sellingPrice: l.sellingPrice, fabricationPrice: l.fabricationPrice, quantity: l.quantity })),
    data.discountPercent,
    Number(store.taxRate)
  );

  try {
    // Invoice numbers derive from a per-store count, which can collide under
    // concurrent sales. The unique constraint guarantees correctness; we retry
    // the whole (atomic) transaction a few times so the loser re-derives the
    // next number instead of surfacing an error to the cashier.
    const MAX_INVOICE_ATTEMPTS = 5;
    let sale: Awaited<ReturnType<typeof prisma.sale.create>> | null = null;

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
            const mapped = batches.map((b) => ({ id: b.id, expiryDate: b.expiryDate, receivedAt: b.receivedAt, stock: Number(b.stock), status: b.status }));

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

          const count = await tx.sale.count({ where: { storeId } });
          const invoiceNumber = formatInvoiceNumber(count + 1);

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
              metadata: { invoiceNumber, total: totals.total },
            },
            tx
          );

          return created;
        });
        break;
      } catch (error) {
        if (error instanceof InsufficientStock) {
          return { error: `Not enough stock for "${error.productName}" (${error.available} available)` };
        }
        if (error instanceof BatchAllocationConflict) {
          return { error: `Stock for "${error.productName}" changed mid-sale — please try again.` };
        }
        if (error instanceof InsufficientExpiryStock) {
          return { error: `Insufficient non-expired stock for "${error.productName}".` };
        }
        const isInvoiceClash =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002" &&
          attempt < MAX_INVOICE_ATTEMPTS - 1;
        if (!isInvoiceClash) throw error;
      }
    }

    if (!sale) return { error: "Could not assign an invoice number. Please try again." };

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
    } catch {
      // notifications are non-critical
    }

    revalidatePath("/sales");
    revalidatePath("/products");
    revalidatePath("/dashboard");

    return { success: true as const, saleId: sale.id, invoiceNumber: sale.invoiceNumber };
  } catch {
    return { error: "Failed to complete sale. Please try again." };
  }
}

/**
 * Returns some or all units of a sale back into stock and refunds the
 * customer for them.
 *
 * The sale's stored money columns are rewritten to their post-return values
 * rather than left at the original amounts, because every revenue/profit
 * aggregate in the app reads those columns directly — recalculating here is
 * what keeps the dashboard and report queries correct without any of them
 * having to know that returns exist. The original figures stay recoverable
 * as `total + refundedTotal`, and per-item history as `returnedQuantity`.
 *
 * Discount and tax are refunded proportionally, so a fully returned sale
 * lands exactly at zero instead of leaving rounding residue behind.
 */
export async function returnSaleItems(saleId: string, input: SaleReturnInput) {
  const context = await getSessionContext();
  if (!context || !can(context.role, "sale.refund")) {
    return { error: "Not authorized" };
  }
  const storeId = requireStoreId(context);

  const parsed = saleReturnSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid return data" };
  const data = parsed.data;

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, storeId },
    include: { items: { include: { product: { select: { allowDecimalQuantity: true } } } } },
  });
  if (!sale) return { error: "Sale not found" };
  if (sale.status === "REFUNDED") return { error: "This sale has already been fully returned" };
  // A tracked line is identified by the presence of batch allocation rows (a
  // sale rung up before tracking was enabled has none → keeps the legacy path).

  const unitsEnabled = (await getStoreFeatures(storeId)).units_enabled;
  const storeToday = getTodayInTimezone(
    (await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { timezone: true } })).timezone
  );

  // Validate every requested line against what is actually still returnable.
  const lines: { item: (typeof sale.items)[number]; quantity: number; overrideBatchId: string | null }[] = [];
  for (const requested of data.items) {
    const item = sale.items.find((i) => i.id === requested.saleItemId);
    if (!item) return { error: "That item is not part of this sale" };

    // Allow fractional returns when the product is decimal-enabled, or when the
    // sold line is already fractional (so a 0.5 kg line stays returnable even if
    // the store later turned units off).
    const allowDecimal =
      (unitsEnabled && item.product.allowDecimalQuantity) || !Number.isInteger(Number(item.quantity));
    if (!isValidQuantity(requested.quantity, allowDecimal)) {
      return { error: "Return quantity must be a whole number for this item." };
    }
    const quantity = round3(requested.quantity);

    const remaining = round3(Number(item.quantity) - Number(item.returnedQuantity));
    if (quantity > remaining) {
      return {
        error:
          remaining === 0
            ? "Those units have already been returned"
            : `Only ${remaining} unit(s) of that item can still be returned`,
      };
    }

    // Phase 5: optional Manager-only return-batch override. Restore this line's
    // stock into a chosen ACTIVE batch of the SAME store/product/variant grain
    // instead of the original allocations. Role is checked from the SESSION.
    let overrideBatchId: string | null = null;
    if (requested.overrideBatchId) {
      if (context.role !== "MANAGER") {
        return { error: "Only a manager can choose a different return batch." };
      }
      const target = await prisma.productBatch.findFirst({
        where: { id: requested.overrideBatchId, storeId, productId: item.productId, variantId: item.variantId },
        select: { id: true, status: true },
      });
      if (!target) return { error: "The chosen return batch doesn't match this item." };
      if (target.status === "ARCHIVED") return { error: "You can't return stock into an archived batch." };
      overrideBatchId = target.id;
    }

    lines.push({ item, quantity, overrideBatchId });
  }

  const originalSubtotal = Number(sale.subtotal);

  // Proportional share of the original discount/tax that these units carried.
  const { returnedGross, returnedDiscount, returnedTax, refundAmount, returnedProfit } =
    computeReturnAmounts(
      { subtotal: originalSubtotal, discount: Number(sale.discount), tax: Number(sale.tax) },
      lines.map((l) => ({
        sellingPrice: Number(l.item.sellingPrice),
        fabricationPrice: Number(l.item.fabricationPrice),
        quantity: l.quantity,
      }))
    );

  // Whether this return closes out every remaining unit on the sale.
  const fullyReturned = sale.items.every((item) => {
    const line = lines.find((l) => l.item.id === item.id);
    return round3(Number(item.quantity) - Number(item.returnedQuantity) - (line?.quantity ?? 0)) === 0;
  });

  try {
    await prisma.$transaction(async (tx) => {
      const note = `Returned from invoice ${sale.invoiceNumber}${data.reason ? ` — ${data.reason}` : ""}`;
      for (const line of lines) {
        await tx.saleItem.update({
          where: { id: line.item.id },
          data: { returnedQuantity: { increment: line.quantity } },
        });

        const allocs = await tx.saleItemBatchAllocation.findMany({
          where: { saleItemId: line.item.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, batchId: true, quantity: true, returnedQuantity: true, batch: { select: { batchCode: true } } },
        });

        if (allocs.length > 0) {
          // Batch-tracked: restore to the EXACT original batches, oldest first.
          const plan = planReturnRestoration(
            line.quantity,
            allocs.map((a) => ({
              id: a.id,
              batchId: a.batchId,
              quantity: Number(a.quantity),
              returnedQuantity: Number(a.returnedQuantity),
            }))
          );
          if (!plan.ok) throw new AllocationIntegrityError(line.item.productId);

          const originalCodes = new Set<string>();
          for (const r of plan.restorations) {
            const cur = allocs.find((a) => a.id === r.allocationId)!;
            originalCodes.add(cur.batch.batchCode);
            // Optimistic guard: block concurrent over-return of the same allocation.
            // Accounting always advances against the ORIGINAL allocation, so
            // outstanding-quantity math stays correct even with an override.
            const guard = await tx.saleItemBatchAllocation.updateMany({
              where: { id: r.allocationId, returnedQuantity: Number(cur.returnedQuantity) },
              data: { returnedQuantity: { increment: r.quantity } },
            });
            if (guard.count === 0) throw new BatchAllocationConflict(line.item.productId);

            // Default: physically restore to the original batch. Override redirects
            // the physical stock (below) but still advances accounting above.
            if (!line.overrideBatchId) {
              await incrementBatchStock(tx, r.batchId, r.quantity);
              await reviveRestoredBatch(tx, r.batchId, storeToday);
              await tx.inventoryMovement.create({
                data: {
                  storeId,
                  productId: line.item.productId,
                  variantId: line.item.variantId,
                  batchId: r.batchId,
                  type: "RETURN",
                  quantity: r.quantity,
                  note,
                  createdById: context.userId,
                },
              });
            }
          }

          // Manager override: put the whole line's stock into the chosen batch.
          if (line.overrideBatchId) {
            await incrementBatchStock(tx, line.overrideBatchId, line.quantity);
            await reviveRestoredBatch(tx, line.overrideBatchId, storeToday);
            await tx.inventoryMovement.create({
              data: {
                storeId,
                productId: line.item.productId,
                variantId: line.item.variantId,
                batchId: line.overrideBatchId,
                type: "RETURN",
                quantity: line.quantity,
                note: `${note} — override destination (original batch ${[...originalCodes].join(", ")})`,
                createdById: context.userId,
              },
            });
          }

          if (line.item.variantId) await incrementVariantStock(tx, line.item.variantId, line.quantity);
          else await incrementProductStock(tx, line.item.productId, line.quantity);
          await assertGrainReconciled(tx, line.item.productId, line.item.variantId);
        } else {
          // Untracked line — existing behavior, unchanged.
          if (line.item.variantId) await incrementVariantStock(tx, line.item.variantId, line.quantity);
          else await incrementProductStock(tx, line.item.productId, line.quantity);
          await tx.inventoryMovement.create({
            data: {
              storeId,
              productId: line.item.productId,
              variantId: line.item.variantId,
              type: "RETURN",
              quantity: line.quantity,
              note,
              createdById: context.userId,
            },
          });
        }
      }

      await tx.sale.update({
        where: { id: sale.id },
        data: {
          subtotal: fullyReturned ? 0 : round2(originalSubtotal - returnedGross),
          discount: fullyReturned ? 0 : round2(Number(sale.discount) - returnedDiscount),
          tax: fullyReturned ? 0 : round2(Number(sale.tax) - returnedTax),
          total: fullyReturned ? 0 : round2(Number(sale.total) - refundAmount),
          netProfit: fullyReturned ? 0 : round2(Number(sale.netProfit) - returnedProfit),
          refundedTotal: round2(Number(sale.refundedTotal) + refundAmount),
          status: fullyReturned ? "REFUNDED" : "PARTIALLY_REFUNDED",
        },
      });

      await logActivity(
        {
          storeId,
          userId: context.userId,
          action: fullyReturned ? "sale.fully_returned" : "sale.partially_returned",
          entity: "Sale",
          entityId: sale.id,
          metadata: {
            invoiceNumber: sale.invoiceNumber,
            refundAmount,
            reason: data.reason || null,
            items: lines.map((l) => ({ productId: l.item.productId, quantity: l.quantity })),
          },
        },
        tx
      );
    });

    revalidatePath("/sales");
    revalidatePath("/products");
    revalidatePath("/dashboard");
    revalidatePath("/reports");

    return { success: true as const, refundAmount, fullyReturned };
  } catch (error) {
    if (error instanceof AllocationIntegrityError) {
      return { error: "This item's batch history is inconsistent — the return was cancelled. Contact an admin." };
    }
    if (error instanceof BatchAllocationConflict) {
      return { error: "This sale changed while processing the return — please try again." };
    }
    return { error: "Failed to process the return. Please try again." };
  }
}

export type ReturnBatchOption = { id: string; batchCode: string; expiryDate: string | null };

/**
 * Manager-only: the ACTIVE batches a return line could be redirected into (Phase 5
 * return-batch override). Keyed by saleItemId; empty for non-Managers, untracked
 * lines, or a sale not in this store — so the UI simply shows no override control.
 */
export async function getReturnBatchOptions(saleId: string): Promise<Record<string, ReturnBatchOption[]>> {
  const context = await getSessionContext();
  if (!context || context.role !== "MANAGER" || !can(context.role, "sale.refund")) return {};
  const storeId = requireStoreId(context);

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, storeId },
    select: { items: { select: { id: true, productId: true, variantId: true, product: { select: { trackBatch: true } } } } },
  });
  if (!sale) return {};

  const result: Record<string, ReturnBatchOption[]> = {};
  for (const item of sale.items) {
    if (!item.product.trackBatch) continue;
    const batches = await prisma.productBatch.findMany({
      where: { storeId, productId: item.productId, variantId: item.variantId, status: "ACTIVE" },
      orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
      select: { id: true, batchCode: true, expiryDate: true },
    });
    if (batches.length > 0) {
      result[item.id] = batches.map((b) => ({
        id: b.id,
        batchCode: b.batchCode,
        expiryDate: b.expiryDate ? toDateKey(b.expiryDate) : null,
      }));
    }
  }
  return result;
}

/** Fixes customer/payment details on a sale. Money and items are untouched. */
export async function updateSaleDetails(saleId: string, input: SaleDetailsInput) {
  const context = await getSessionContext();
  if (!context || !can(context.role, "sale.edit")) {
    return { error: "Not authorized" };
  }
  const storeId = requireStoreId(context);

  const parsed = saleDetailsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid sale details" };
  const data = parsed.data;

  const sale = await prisma.sale.findFirst({ where: { id: saleId, storeId } });
  if (!sale) return { error: "Sale not found" };

  try {
    await prisma.sale.update({
      where: { id: sale.id },
      data: {
        customerName: data.customerName || null,
        customerPhone: data.customerPhone || null,
        paymentMethod: data.paymentMethod,
      },
    });

    await logActivity({
      storeId,
      userId: context.userId,
      action: "sale.updated",
      entity: "Sale",
      entityId: sale.id,
      metadata: { invoiceNumber: sale.invoiceNumber },
    });

    revalidatePath("/sales");
    return { success: true as const };
  } catch {
    return { error: "Failed to update the sale. Please try again." };
  }
}

/**
 * Removes a sale entirely — for genuine mistakes (wrong item rung up, test
 * entries), not for customer returns. Stock is restored only for units the
 * customer still held; units already given back are skipped, since an earlier
 * return already put those back. SaleItem rows cascade with the sale.
 */
export async function deleteSale(saleId: string) {
  const context = await getSessionContext();
  if (!context || !can(context.role, "sale.delete")) {
    return { error: "Not authorized" };
  }
  const storeId = requireStoreId(context);

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, storeId },
    include: { items: true },
  });
  if (!sale) return { error: "Sale not found" };

  const deleteNote = `Sale ${sale.invoiceNumber} deleted — stock restored`;
  const storeToday = getTodayInTimezone(
    (await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { timezone: true } })).timezone
  );

  try {
    await prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        const outstanding = round3(Number(item.quantity) - Number(item.returnedQuantity));

        const allocs = await tx.saleItemBatchAllocation.findMany({
          where: { saleItemId: item.id },
          select: { id: true, batchId: true, quantity: true, returnedQuantity: true },
        });

        if (allocs.length > 0) {
          // Batch-tracked: restore outstanding units to the EXACT original
          // batches. A mismatch means the history is broken — abort, never guess.
          const plan = planDeletionRestoration(
            outstanding,
            allocs.map((a) => ({
              id: a.id,
              batchId: a.batchId,
              quantity: Number(a.quantity),
              returnedQuantity: Number(a.returnedQuantity),
            }))
          );
          if (!plan.ok) throw new AllocationIntegrityError(item.productId);

          for (const r of plan.restorations) {
            await incrementBatchStock(tx, r.batchId, r.quantity);
            await reviveRestoredBatch(tx, r.batchId, storeToday);
            await tx.inventoryMovement.create({
              data: {
                storeId,
                productId: item.productId,
                variantId: item.variantId,
                batchId: r.batchId,
                type: "RETURN",
                quantity: r.quantity,
                note: deleteNote,
                createdById: context.userId,
              },
            });
          }

          if (outstanding > 0) {
            if (item.variantId) await incrementVariantStock(tx, item.variantId, outstanding);
            else await incrementProductStock(tx, item.productId, outstanding);
            await assertGrainReconciled(tx, item.productId, item.variantId);
          }
        } else {
          // Untracked line — existing behavior, unchanged.
          if (outstanding <= 0) continue;
          if (item.variantId) await incrementVariantStock(tx, item.variantId, outstanding);
          else await incrementProductStock(tx, item.productId, outstanding);
          await tx.inventoryMovement.create({
            data: {
              storeId,
              productId: item.productId,
              variantId: item.variantId,
              type: "RETURN",
              quantity: outstanding,
              note: deleteNote,
              createdById: context.userId,
            },
          });
        }
      }

      await logActivity(
        {
          storeId,
          userId: context.userId,
          action: "sale.deleted",
          entity: "Sale",
          entityId: sale.id,
          metadata: {
            invoiceNumber: sale.invoiceNumber,
            total: Number(sale.total),
            itemCount: sale.items.length,
          },
        },
        tx
      );

      await tx.sale.delete({ where: { id: sale.id } });
    });

    revalidatePath("/sales");
    revalidatePath("/products");
    revalidatePath("/dashboard");
    revalidatePath("/reports");

    return { success: true as const };
  } catch (error) {
    if (error instanceof AllocationIntegrityError) {
      return { error: "This sale's batch history is inconsistent — deletion was cancelled. Contact an admin." };
    }
    return { error: "Failed to delete the sale. Please try again." };
  }
}
