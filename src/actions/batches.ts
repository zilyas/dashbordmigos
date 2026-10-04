"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { logActivity } from "@/lib/audit";
import { getStoreFeatures } from "@/lib/features";
import { incrementProductStock, incrementVariantStock, touchProductForVariant } from "@/lib/inventory";
import { round3 } from "@/lib/sale-math";
import {
  reconcileBatchStock,
  validateExpiryTrackingActivation,
  isValidDateKey,
  deriveBatchStatus,
} from "@/lib/batches";
import { getTodayInTimezone, isExpiredOnDate, toDateKey } from "@/lib/timezone";
import { getProductBatchView, getStoreBatchReconciliation } from "@/lib/queries/batches";
import { runExpirySweep } from "@/lib/expiry-sweep";
import {
  enableBatchTrackingSchema,
  receiveBatchStockSchema,
  adjustBatchStockSchema,
  enableExpiryTrackingSchema,
  updateBatchExpirySchema,
  archiveBatchSchema,
  type EnableBatchTrackingInput,
  type ReceiveBatchStockInput,
  type AdjustBatchStockInput,
  type EnableExpiryTrackingInput,
  type UpdateBatchExpiryInput,
  type ArchiveBatchInput,
} from "@/lib/validations/batch";

// Batch inventory is Manager-only; the guard resolves storeId from the session
// (never from client input) and rejects Sellers / storeless Super Admins.
const requireInventoryManager = requireStorePermission("inventory.manage");

const OPENING_CODE = "OPENING";

// Control-flow errors thrown inside transactions, mapped to friendly messages.
class AlreadyEnabled extends Error {}
class ArchivedBatch extends Error {}
class Conflict extends Error {}
class NegativeStock extends Error {}
class Unreconciled extends Error {}
class ExpiryMismatch extends Error {}

/** All batch actions require the store-level feature flag to be on. */
async function ensureFeatureEnabled(storeId: string): Promise<true | { error: string }> {
  const features = await getStoreFeatures(storeId);
  if (!features.expiry_batch_enabled) return { error: "Batch tracking is not enabled for this store." };
  return true;
}

/** Whether decimal quantities are allowed for a product (store + product policy). */
async function decimalAllowed(storeId: string, allowDecimalQuantity: boolean): Promise<boolean> {
  const features = await getStoreFeatures(storeId);
  return features.units_enabled && allowDecimalQuantity;
}

/** Store-local today (YYYY-MM-DD) from the authenticated store's timezone. */
async function getStoreToday(storeId: string): Promise<string> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { timezone: true } });
  return getTodayInTimezone(store.timezone);
}

/** Reconciliation guard, run INSIDE a transaction before commit: Σ batch stock at
 *  the affected grain must equal the aggregate. Throws {@link Unreconciled}. */
async function assertReconciled(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null
) {
  if (variantId) {
    const variant = await tx.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    const batches = await tx.productBatch.findMany({
      where: { productId, variantId },
      select: { stock: true },
    });
    const r = reconcileBatchStock(
      Number(variant.stock),
      batches.map((b) => ({ id: "", expiryDate: null, receivedAt: "", stock: Number(b.stock) }))
    );
    if (!r.reconciled) throw new Unreconciled(`variant ${variantId} off by ${r.difference}`);
  } else {
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { stock: true },
    });
    const batches = await tx.productBatch.findMany({
      where: { productId, variantId: null },
      select: { stock: true },
    });
    const r = reconcileBatchStock(
      Number(product.stock),
      batches.map((b) => ({ id: "", expiryDate: null, receivedAt: "", stock: Number(b.stock) }))
    );
    if (!r.reconciled) throw new Unreconciled(`product ${productId} off by ${r.difference}`);
  }
}

function revalidateBatchRoutes(productId: string) {
  revalidatePath(`/products/${productId}/edit`);
  revalidatePath("/products");
  revalidatePath("/dashboard");
  revalidatePath("/sales/new");
}

// ── Enable tracking + opening-stock backfill ─────────────────────────────────

export async function enableProductBatchTracking(input: EnableBatchTrackingInput) {
  const session = await requireInventoryManager();
  const parsed = enableBatchTrackingSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request" };
  const { storeId, userId } = session;

  const feature = await ensureFeatureEnabled(storeId);
  if (feature !== true) return feature;

  const product = await prisma.product.findFirst({
    where: { id: parsed.data.productId, storeId },
    select: {
      id: true,
      name: true,
      hasVariants: true,
      trackBatch: true,
      trackExpiry: true,
      stock: true,
      fabricationPrice: true,
      variants: { select: { id: true, stock: true, fabricationPrice: true } },
    },
  });
  if (!product) return { error: "Product not found" };
  if (product.trackExpiry) return { error: "Expiry tracking is not supported yet." };
  if (product.trackBatch) return { success: true as const, alreadyEnabled: true as const };

  try {
    let openingBatches = 0;
    await prisma.$transaction(async (tx) => {
      // Atomic false→true flip: only the winner backfills; concurrent callers
      // and re-runs get count 0 and short-circuit to "already enabled".
      const flip = await tx.product.updateMany({
        where: { id: product.id, storeId, trackBatch: false },
        data: { trackBatch: true },
      });
      if (flip.count === 0) throw new AlreadyEnabled();

      if (product.hasVariants) {
        for (const v of product.variants) {
          const stock = round3(Number(v.stock));
          if (stock <= 0) continue; // zero-stock variant needs no opening batch
          const batch = await tx.productBatch.create({
            data: {
              storeId,
              productId: product.id,
              variantId: v.id,
              batchCode: OPENING_CODE,
              expiryDate: null,
              stock,
              costPrice: v.fabricationPrice ?? product.fabricationPrice,
              status: "ACTIVE",
            },
          });
          await tx.inventoryMovement.create({
            data: {
              storeId,
              productId: product.id,
              variantId: v.id,
              batchId: batch.id,
              type: "IN",
              quantity: stock,
              note: "Opening stock batch (tracking enabled)",
              createdById: userId,
            },
          });
          openingBatches++;
          await assertReconciled(tx, product.id, v.id);
        }
      } else {
        const stock = round3(Number(product.stock));
        if (stock > 0) {
          const batch = await tx.productBatch.create({
            data: {
              storeId,
              productId: product.id,
              variantId: null,
              batchCode: OPENING_CODE,
              expiryDate: null,
              stock,
              costPrice: product.fabricationPrice,
              status: "ACTIVE",
            },
          });
          await tx.inventoryMovement.create({
            data: {
              storeId,
              productId: product.id,
              batchId: batch.id,
              type: "IN",
              quantity: stock,
              note: "Opening stock batch (tracking enabled)",
              createdById: userId,
            },
          });
          openingBatches++;
        }
        await assertReconciled(tx, product.id, null);
      }

      await logActivity(
        {
          storeId,
          userId,
          action: "batch.trackingEnabled",
          entity: "Product",
          entityId: product.id,
          metadata: { name: product.name, openingBatches },
        },
        tx
      );
    });

    revalidateBatchRoutes(product.id);
    return { success: true as const, alreadyEnabled: false as const, openingBatches };
  } catch (error) {
    if (error instanceof AlreadyEnabled) return { success: true as const, alreadyEnabled: true as const };
    if (error instanceof Unreconciled) return { error: "Could not enable tracking: stock reconciliation failed." };
    throw error;
  }
}

// ── Receiving stock ──────────────────────────────────────────────────────────

export async function receiveBatchStock(input: ReceiveBatchStockInput) {
  const session = await requireInventoryManager();
  const parsed = receiveBatchStockSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid batch data" };
  const { storeId, userId } = session;
  const data = parsed.data;

  const feature = await ensureFeatureEnabled(storeId);
  if (feature !== true) return feature;

  const product = await prisma.product.findFirst({
    where: { id: data.productId, storeId },
    select: { id: true, hasVariants: true, trackBatch: true, trackExpiry: true, allowDecimalQuantity: true },
  });
  if (!product) return { error: "Product not found" };
  if (!product.trackBatch) return { error: "This product is not batch-tracked." };

  const variantId = data.variantId || null;
  if (product.hasVariants && !variantId) return { error: "Choose a variant to receive into." };
  if (!product.hasVariants && variantId) return { error: "This product has no variants." };
  if (variantId) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, productId: product.id, storeId },
      select: { id: true },
    });
    if (!variant) return { error: "Variant not found for this product." };
  }

  const allowDecimal = await decimalAllowed(storeId, product.allowDecimalQuantity);
  if (!allowDecimal && !Number.isInteger(data.quantity)) {
    return { error: "Quantity must be a whole number for this product." };
  }
  const quantity = round3(data.quantity);

  // Expiry handling. For a trackExpiry product a valid, non-past date is required;
  // for a batch-only product the date stays null and FIFO applies as before.
  let expiryKey: string | null = null;
  if (product.trackExpiry) {
    const submitted = data.expiryDate || "";
    if (!submitted || !isValidDateKey(submitted)) {
      return { error: "An expiry date is required for this product." };
    }
    const storeToday = await getStoreToday(storeId);
    if (submitted < storeToday) return { error: "Expiry date cannot be in the past." };
    expiryKey = submitted;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.productBatch.findFirst({
        where: { storeId, productId: product.id, variantId, batchCode: data.batchCode },
        select: { id: true, status: true, expiryDate: true },
      });

      let batchId: string;
      let reused: boolean;
      if (existing) {
        if (existing.status === "ARCHIVED") throw new ArchivedBatch();
        // For expiry-tracked products, the submitted date must match the existing
        // batch's date — never silently change a lot's expiry via receiving.
        if (product.trackExpiry) {
          const existingKey = existing.expiryDate ? toDateKey(existing.expiryDate) : null;
          if (existingKey !== expiryKey) throw new ExpiryMismatch();
        }
        await tx.productBatch.update({
          where: { id: existing.id },
          data: {
            stock: { increment: quantity },
            status: "ACTIVE", // revive a DEPLETED batch (date is >= today, so not expired)
            ...(data.costPrice != null ? { costPrice: data.costPrice } : {}),
          },
        });
        batchId = existing.id;
        reused = true;
      } else {
        const created = await tx.productBatch.create({
          data: {
            storeId,
            productId: product.id,
            variantId,
            batchCode: data.batchCode,
            expiryDate: expiryKey ? new Date(expiryKey + "T00:00:00.000Z") : null,
            stock: quantity,
            costPrice: data.costPrice ?? null,
            status: "ACTIVE",
          },
          select: { id: true },
        });
        batchId = created.id;
        reused = false;
      }

      // Aggregate cache moves with the batch, in the same transaction.
      if (variantId) await incrementVariantStock(tx, variantId, quantity);
      else await incrementProductStock(tx, product.id, quantity);

      await tx.inventoryMovement.create({
        data: {
          storeId,
          productId: product.id,
          variantId,
          batchId,
          type: "SUPPLIER_DELIVERY",
          quantity,
          note: `Received into batch ${data.batchCode}`,
          createdById: userId,
        },
      });

      await assertReconciled(tx, product.id, variantId);

      await logActivity(
        {
          storeId,
          userId,
          action: "batch.received",
          entity: "ProductBatch",
          entityId: batchId,
          metadata: { productId: product.id, variantId, batchCode: data.batchCode, quantity, reused },
        },
        tx
      );

      return { batchId, reused };
    });

    revalidateBatchRoutes(product.id);
    return { success: true as const, ...result };
  } catch (error) {
    if (error instanceof ArchivedBatch) return { error: "That batch is archived and cannot receive stock." };
    if (error instanceof ExpiryMismatch) return { error: "That batch code already exists with a different expiry date." };
    if (error instanceof Unreconciled) return { error: "Receiving failed: stock reconciliation error." };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That batch code was just created — please try again." };
    }
    throw error;
  }
}

// ── Stock adjustment (absolute counted quantity) ─────────────────────────────

export async function adjustBatchStock(input: AdjustBatchStockInput) {
  const session = await requireInventoryManager();
  const parsed = adjustBatchStockSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid adjustment data" };
  const { storeId, userId } = session;
  const data = parsed.data;

  const feature = await ensureFeatureEnabled(storeId);
  if (feature !== true) return feature;

  const batch = await prisma.productBatch.findFirst({
    where: { id: data.batchId, storeId },
    select: {
      id: true,
      stock: true,
      status: true,
      expiryDate: true,
      variantId: true,
      productId: true,
      product: { select: { trackBatch: true, trackExpiry: true, allowDecimalQuantity: true } },
    },
  });
  if (!batch) return { error: "Batch not found" };
  if (batch.status === "ARCHIVED") return { error: "Archived batches cannot be adjusted." };
  if (!batch.product.trackBatch) return { error: "This product is not batch-tracked." };

  const allowDecimal = await decimalAllowed(storeId, batch.product.allowDecimalQuantity);
  if (!allowDecimal && !Number.isInteger(data.newStock)) {
    return { error: "Stock must be a whole number for this product." };
  }
  const newStock = round3(data.newStock);
  const oldStock = round3(Number(batch.stock));
  const delta = round3(newStock - oldStock);
  if (delta === 0) return { success: true as const, unchanged: true as const };

  // Expiry-tracked batches can't hold positive stock without a date.
  if (batch.product.trackExpiry && newStock > 0 && !batch.expiryDate) {
    return { error: "Assign an expiry date to this batch before adding stock." };
  }

  // Status precedence: ARCHIVED (blocked above) > zero stock → DEPLETED >
  // expired (trackExpiry + past date) → EXPIRED > ACTIVE. An expired batch is
  // never revived to ACTIVE by an adjustment.
  const isExpired =
    batch.product.trackExpiry && !!batch.expiryDate && isExpiredOnDate(batch.expiryDate, await getStoreToday(storeId));
  const targetStatus = deriveBatchStatus(batch.status, newStock, isExpired);

  try {
    await prisma.$transaction(async (tx) => {
      // Conditional set guarding against a concurrent change (lost update).
      const upd = await tx.productBatch.updateMany({
        where: { id: batch.id, stock: oldStock, status: { not: "ARCHIVED" } },
        data: { stock: newStock, status: targetStatus },
      });
      if (upd.count === 0) throw new Conflict();

      // Aggregate moves by the same delta; never let it go negative.
      if (delta > 0) {
        if (batch.variantId) await incrementVariantStock(tx, batch.variantId, delta);
        else await incrementProductStock(tx, batch.productId, delta);
      } else {
        const dec = -delta;
        const guard = batch.variantId
          ? await tx.productVariant.updateMany({
              where: { id: batch.variantId, stock: { gte: dec } },
              data: { stock: { decrement: dec } },
            })
          : await tx.product.updateMany({
              where: { id: batch.productId, stock: { gte: dec } },
              data: { stock: { decrement: dec } },
            });
        if (guard.count === 0) throw new NegativeStock();
        // Variant-only write: bump the parent so /api/v1/stock?updatedSince= sees it.
        if (batch.variantId) await touchProductForVariant(tx, batch.variantId);
      }

      await tx.inventoryMovement.create({
        data: {
          storeId,
          productId: batch.productId,
          variantId: batch.variantId,
          batchId: batch.id,
          type: "ADJUSTMENT",
          quantity: delta,
          note: `Batch count adjusted: ${data.reason}`,
          createdById: userId,
        },
      });

      await assertReconciled(tx, batch.productId, batch.variantId);

      await logActivity(
        {
          storeId,
          userId,
          action: "batch.adjusted",
          entity: "ProductBatch",
          entityId: batch.id,
          metadata: { productId: batch.productId, variantId: batch.variantId, from: oldStock, to: newStock, reason: data.reason },
        },
        tx
      );
    });

    revalidateBatchRoutes(batch.productId);
    return { success: true as const, unchanged: false as const };
  } catch (error) {
    if (error instanceof Conflict) return { error: "The batch changed while you were editing — reload and try again." };
    if (error instanceof NegativeStock) return { error: "That adjustment would make aggregate stock negative." };
    if (error instanceof Unreconciled) return { error: "Adjustment failed: stock reconciliation error." };
    throw error;
  }
}

// ── Reconciliation (read-only Manager tools; never auto-repair) ───────────────

export async function getBatchReconciliation(productId: string) {
  const session = await requireInventoryManager();
  const feature = await ensureFeatureEnabled(session.storeId);
  if (feature !== true) return feature;
  const view = await getProductBatchView(productId, session.storeId);
  if (!view) return { error: "Product not found" };
  return { success: true as const, reconciliation: view.reconciliation };
}

export async function reconcileStoreBatchInventory() {
  const session = await requireInventoryManager();
  const feature = await ensureFeatureEnabled(session.storeId);
  if (feature !== true) return feature;
  const result = await getStoreBatchReconciliation(session.storeId);
  return { success: true as const, ...result };
}

// ── Enable expiry tracking (Phase 4c1) ───────────────────────────────────────

const dateOnly = (key: string) => new Date(key + "T00:00:00.000Z");

export async function enableProductExpiryTracking(input: EnableExpiryTrackingInput) {
  const session = await requireInventoryManager();
  const parsed = enableExpiryTrackingSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request" };
  const { storeId, userId } = session;

  const feature = await ensureFeatureEnabled(storeId);
  if (feature !== true) return feature;

  const product = await prisma.product.findFirst({
    where: { id: parsed.data.productId, storeId },
    select: {
      id: true,
      name: true,
      trackBatch: true,
      trackExpiry: true,
      batches: { select: { id: true, stock: true, status: true } },
    },
  });
  if (!product) return { error: "Product not found" };
  if (!product.trackBatch) return { error: "Enable batch tracking first." };
  if (product.trackExpiry) return { success: true as const, alreadyEnabled: true as const };

  // Every positive-stock, non-archived batch must receive a valid date.
  const required = product.batches
    .filter((b) => b.status !== "ARCHIVED" && round3(Number(b.stock)) > 0)
    .map((b) => b.id);
  const storeToday = await getStoreToday(storeId);
  const check = validateExpiryTrackingActivation(required, parsed.data.assignments, storeToday);
  if (!check.ok) return { error: check.error };

  try {
    await prisma.$transaction(async (tx) => {
      const flip = await tx.product.updateMany({
        where: { id: product.id, storeId, trackBatch: true, trackExpiry: false },
        data: { trackExpiry: true },
      });
      if (flip.count === 0) throw new AlreadyEnabled();

      for (const [batchId, dateKey] of check.dates) {
        await tx.productBatch.update({
          where: { id: batchId },
          data: { expiryDate: dateOnly(dateKey), status: "ACTIVE" },
        });
      }
      // Zero-stock batches keep their status (DEPLETED stays DEPLETED).
      await logActivity(
        {
          storeId,
          userId,
          action: "batch.expiryTrackingEnabled",
          entity: "Product",
          entityId: product.id,
          metadata: { name: product.name, datedBatches: check.dates.size },
        },
        tx
      );
    });

    revalidateBatchRoutes(product.id);
    return { success: true as const, alreadyEnabled: false as const };
  } catch (error) {
    if (error instanceof AlreadyEnabled) return { success: true as const, alreadyEnabled: true as const };
    throw error;
  }
}

// ── Correct a batch expiry date ──────────────────────────────────────────────

export async function updateBatchExpiryDate(input: UpdateBatchExpiryInput) {
  const session = await requireInventoryManager();
  const parsed = updateBatchExpirySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request" };
  const { storeId, userId } = session;

  const feature = await ensureFeatureEnabled(storeId);
  if (feature !== true) return feature;

  const batch = await prisma.productBatch.findFirst({
    where: { id: parsed.data.batchId, storeId },
    select: { id: true, stock: true, status: true, expiryDate: true, productId: true, product: { select: { trackExpiry: true } } },
  });
  if (!batch) return { error: "Batch not found" };
  if (!batch.product.trackExpiry) return { error: "This product does not use expiry tracking." };

  const newKey = parsed.data.expiryDate;
  if (!isValidDateKey(newKey)) return { error: "Invalid date." };
  const storeToday = await getStoreToday(storeId);
  // A positive-stock batch can't be moved to a past date (that would make live
  // stock retroactively expired); correcting an already-expired date is deferred.
  if (round3(Number(batch.stock)) > 0 && newKey < storeToday) {
    return { error: "A batch with stock cannot be given a past expiry date." };
  }
  const oldKey = batch.expiryDate ? toDateKey(batch.expiryDate) : null;

  // Recompute status from the new date (never revive an expired dated batch).
  const isExpired = isExpiredOnDate(newKey, storeToday);
  const targetStatus = deriveBatchStatus(batch.status, Number(batch.stock), isExpired);

  await prisma.$transaction(async (tx) => {
    await tx.productBatch.update({
      where: { id: batch.id },
      data: { expiryDate: dateOnly(newKey), status: targetStatus },
    });
    await logActivity(
      {
        storeId,
        userId,
        action: "batch.expiryDateUpdated",
        entity: "ProductBatch",
        entityId: batch.id,
        metadata: { productId: batch.productId, from: oldKey, to: newKey },
      },
      tx
    );
  });

  revalidateBatchRoutes(batch.productId);
  return { success: true as const };
}

// ── Query-time status maintenance (never required for correctness) ────────────

/**
 * Marks positive-stock, ACTIVE batches whose date is before store-local today as
 * EXPIRED. Purely a status-hygiene helper — sale eligibility already compares
 * expiryDate directly, so correctness never depends on this. Does not touch
 * stock, aggregate, allocations, or archive anything. Idempotent (a no-op when
 * nothing changed logs nothing, avoiding noise).
 */
export async function markExpiredBatches() {
  const session = await requireInventoryManager();
  const feature = await ensureFeatureEnabled(session.storeId);
  if (feature !== true) return feature;
  const { storeId, userId } = session;

  const storeToday = await getStoreToday(storeId);
  const stale = await prisma.productBatch.findMany({
    where: {
      storeId,
      status: "ACTIVE",
      stock: { gt: 0 },
      expiryDate: { not: null, lt: dateOnly(storeToday) },
      product: { trackExpiry: true },
    },
    select: { id: true },
  });
  if (stale.length === 0) return { success: true as const, updated: 0 };

  await prisma.productBatch.updateMany({
    where: { id: { in: stale.map((b) => b.id) } },
    data: { status: "EXPIRED" },
  });
  await logActivity({
    storeId,
    userId,
    action: "batch.expiredMarked",
    entity: "Store",
    entityId: storeId,
    metadata: { updated: stale.length },
  });

  revalidatePath("/products");
  return { success: true as const, updated: stale.length };
}

/**
 * Manager-triggered expiry status refresh + notification sweep for THEIR store
 * only. Idempotent (dedupe-keyed notifications; status hygiene is a no-op when
 * nothing changed). Records a single activity entry for the whole operation.
 */
export async function refreshExpiryStatusAndNotifications() {
  const session = await requireInventoryManager();
  const feature = await ensureFeatureEnabled(session.storeId);
  if (feature !== true) return feature;
  const { storeId, userId } = session;

  const summary = await runExpirySweep({ storeId });

  await logActivity({
    storeId,
    userId,
    action: "batch.expiryRefreshed",
    entity: "Store",
    entityId: storeId,
    metadata: {
      statusesUpdated: summary.statusesUpdated,
      notificationsCreated: summary.notificationsCreated,
      integrityWarnings: summary.integrityWarnings,
    },
  });

  revalidatePath("/products");
  revalidatePath("/reports/expiry");
  revalidatePath("/", "layout");
  return { success: true as const, summary };
}

// ── Item 1: Archive a batch (Phase 5) ────────────────────────────────────────

/**
 * Terminally retire a batch (damaged/recalled/written off). ARCHIVED is sticky
 * (deriveBatchStatus keeps it; allocation/sale filters exclude it). Stock is NOT
 * changed — archiving positive-stock leaves that stock outside the sellable pool
 * but still counted in the aggregate; a Manager can zero it first via
 * adjustBatchStock if they mean to write it off.
 */
export async function archiveBatch(input: ArchiveBatchInput) {
  const session = await requireInventoryManager();
  const parsed = archiveBatchSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request" };
  const { storeId, userId } = session;

  const feature = await ensureFeatureEnabled(storeId);
  if (feature !== true) return feature;

  const batch = await prisma.productBatch.findFirst({
    where: { id: parsed.data.batchId, storeId },
    select: { id: true, status: true, productId: true, batchCode: true },
  });
  if (!batch) return { error: "Batch not found" };
  if (batch.status === "ARCHIVED") return { success: true as const, alreadyArchived: true as const };

  await prisma.$transaction(async (tx) => {
    await tx.productBatch.update({ where: { id: batch.id }, data: { status: "ARCHIVED" } });
    await logActivity(
      {
        storeId,
        userId,
        action: "batch.archived",
        entity: "ProductBatch",
        entityId: batch.id,
        metadata: { productId: batch.productId, batchCode: batch.batchCode, reason: parsed.data.reason },
      },
      tx
    );
  });

  revalidateBatchRoutes(batch.productId);
  return { success: true as const, alreadyArchived: false as const };
}

// ── Item 2: Disable batch tracking (Phase 5) ─────────────────────────────────

/**
 * Revert a batch-tracked product to a simple (untracked) product, keeping the
 * aggregate stock as-is: archive every non-ARCHIVED batch (stock unchanged) and
 * clear trackBatch/trackExpiry. Reconciliation is verified first — a pre-existing
 * aggregate/batch drift blocks the operation rather than being papered over.
 * Idempotent. The direct-stock-edit guard in updateProduct/updateVariant falls
 * away naturally once trackBatch is false (no second code path).
 */
export async function disableProductBatchTracking(productId: string) {
  const session = await requireInventoryManager();
  const { storeId, userId } = session;

  const feature = await ensureFeatureEnabled(storeId);
  if (feature !== true) return feature;

  const product = await prisma.product.findFirst({
    where: { id: productId, storeId },
    select: { id: true, name: true, trackBatch: true },
  });
  if (!product) return { error: "Product not found" };
  if (!product.trackBatch) return { success: true as const, alreadyDisabled: true as const };

  // Block on any pre-existing reconciliation drift (aggregate vs Σ all batches).
  const view = await getProductBatchView(productId, storeId);
  if (view && !view.reconciliation.ok) {
    return { error: "Stock doesn't reconcile with batches — resolve the discrepancy before disabling." };
  }

  const result = await prisma.$transaction(async (tx) => {
    // Atomic guard: only the true→false transition performs the archive.
    const flip = await tx.product.updateMany({
      where: { id: product.id, storeId, trackBatch: true },
      data: { trackBatch: false, trackExpiry: false },
    });
    if (flip.count === 0) return { alreadyDisabled: true as const, archived: 0 };

    const archived = await tx.productBatch.updateMany({
      where: { productId: product.id, storeId, status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED" },
    });

    await logActivity(
      {
        storeId,
        userId,
        action: "batch.trackingDisabled",
        entity: "Product",
        entityId: product.id,
        metadata: { name: product.name, batchesArchived: archived.count },
      },
      tx
    );
    return { alreadyDisabled: false as const, archived: archived.count };
  });

  revalidateBatchRoutes(product.id);
  return { success: true as const, ...result };
}
