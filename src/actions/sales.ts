"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { logActivity } from "@/lib/audit";
import { logServerError } from "@/lib/logger";
import {
  incrementProductStock,
  incrementVariantStock,
  incrementBatchStock,
} from "@/lib/inventory";
import { planReturnRestoration, planDeletionRestoration } from "@/lib/batches";
import { getTodayInTimezone, toDateKey } from "@/lib/timezone";
import { computeReturnAmounts, round2, round3, isValidQuantity } from "@/lib/sale-math";
import { getStoreFeatures } from "@/lib/features";
import {
  createSaleCore,
  assertGrainReconciled,
  BatchAllocationConflict,
  SaleCoreUnexpectedError,
  type CreateSaleResult,
} from "@/lib/sales/create-sale";
import {
  saleReturnSchema,
  saleDetailsSchema,
  type SaleInput,
  type SaleReturnInput,
  type SaleDetailsInput,
} from "@/lib/validations/sale";


/**
 * Generic failure text for the POS. Deliberately says nothing about the cause:
 * everything useful goes to the server log, nothing extra goes to the shop
 * floor.
 */
const SALE_FAILED = "Failed to complete sale. Please try again." as const;

/**
 * Text for failures that retrying can never fix. The Sept 2026 incident: the
 * `invoice_sequences` table (migration 20260924180000_invoice_sequence) was
 * never applied in production because `prisma migrate deploy` was missing from
 * the deploy path until 44d48ed, so `tx.invoiceSequence.upsert` raised P2021
 * and every sale rolled back. The POS said "Please try again", so shop staff
 * hammered the button against a schema that could not serve them.
 */
const SALE_FAILED_PERMANENTLY =
  "This sale could not be recorded because of a server problem. Retrying will not help — please contact an administrator." as const;

/**
 * P2021 (table does not exist) / P2022 (column does not exist) mean the
 * deployed schema and the deployed code disagree. No amount of retrying
 * reconciles that, so the POS must say so instead of inviting a retry.
 * Intentionally just these two codes — not an error taxonomy.
 */
function isSchemaMismatch(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022")
  );
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
 * POS sale creation, as a server action.
 *
 * The ~390 lines this used to hold now live in `createSaleCore`
 * (src/lib/sales/create-sale.ts) so the offline-POS route handler can reach
 * them without a session. What stays here is what is genuinely an *action*
 * concern: resolving the session, RBAC, cache revalidation, and flattening the
 * core's rich discriminated result down to the one string the POS renders.
 *
 * The flattening is lossy ON PURPOSE. `src/components/sales/pos-terminal.tsx`
 * prints `error` verbatim, so every failure mode collapses to one message and
 * the machine-readable `code` is dropped — HTTP callers get the codes instead.
 */
export async function createSale(input: SaleInput) {
  const context = await getSessionContext();
  if (!context || !can(context.role, "sale.create")) {
    return { error: "Not authorized" };
  }
  const storeId = requireStoreId(context);

  let result: CreateSaleResult;
  try {
    // No options: an online POS sale has no till-supplied id, no till clock and
    // — deliberately — no `expectedTotal`. The price-override path inside the
    // core is unreachable from here, which is the point of gating it on
    // `offline`.
    result = await createSaleCore({ userId: context.userId, role: context.role, storeId }, input);
  } catch (error) {
    // Bind and log: this used to be a bare `catch {}`, which collapsed every
    // failure mode of this ~370-line function into one opaque string with no
    // server-side trace at all. `logServerError` picks up the proxy-stamped
    // `x-request-id` itself, so the log line joins the rest of the request.
    // The core wraps unexpected errors to carry the line count and total it
    // alone could compute; `cause` is the error that actually happened.
    const cause = error instanceof SaleCoreUnexpectedError ? error.cause : error;
    const diagnostics =
      error instanceof SaleCoreUnexpectedError ? error.diagnostics : { lineCount: 0, total: 0 };
    await logServerError("app", cause, {
      action: "sale.create",
      storeId,
      userId: context.userId,
      lineCount: diagnostics.lineCount,
      total: diagnostics.total,
      schemaMismatch: isSchemaMismatch(cause),
    });
    // The returned string is rendered verbatim in the POS
    // (src/components/sales/pos-terminal.tsx) — it must never carry a Prisma
    // code, a table name, SQL or a stack. Full detail stays in the log above.
    return { error: isSchemaMismatch(cause) ? SALE_FAILED_PERMANENTLY : SALE_FAILED };
  }

  if (!result.ok) return { error: result.message };

  revalidatePath("/sales");
  revalidatePath("/products");
  revalidatePath("/dashboard");

  return { success: true as const, saleId: result.saleId, invoiceNumber: result.invoiceNumber };
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
  } catch (error) {
    await logServerError("app", error, {
      action: "sale.updateDetails",
      storeId,
      userId: context.userId,
      saleId: sale.id,
    });
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
