-- Phase 4a — expiry/batch tracking FOUNDATION (dormant, additive, backward-compatible).
--
-- This migration only ADDS structures. It changes no existing stock/quantity
-- column, backfills no data, and creates no batches. Existing products get
-- trackBatch=false / trackExpiry=false; existing stores/sales are untouched.
-- Nothing activates batch tracking until the coherent operational release ships
-- (see .ai/phase4-expiry-batch-design.md).

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('ACTIVE', 'DEPLETED', 'EXPIRED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "inventory_movements" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "trackBatch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trackExpiry" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "product_batches" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "batchCode" TEXT NOT NULL,
    "expiryDate" DATE,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "costPrice" DECIMAL(10,2),
    "status" "BatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_item_batch_allocations" (
    "id" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "returnedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_item_batch_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_batches_storeId_idx" ON "product_batches"("storeId");

-- CreateIndex
CREATE INDEX "product_batches_productId_variantId_status_idx" ON "product_batches"("productId", "variantId", "status");

-- CreateIndex
CREATE INDEX "product_batches_storeId_expiryDate_idx" ON "product_batches"("storeId", "expiryDate");

-- CreateIndex
CREATE INDEX "sale_item_batch_allocations_saleItemId_idx" ON "sale_item_batch_allocations"("saleItemId");

-- CreateIndex
CREATE INDEX "sale_item_batch_allocations_batchId_idx" ON "sale_item_batch_allocations"("batchId");

-- CreateIndex
CREATE INDEX "inventory_movements_batchId_idx" ON "inventory_movements"("batchId");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_item_batch_allocations" ADD CONSTRAINT "sale_item_batch_allocations_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_item_batch_allocations" ADD CONSTRAINT "sale_item_batch_allocations_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Batch-code uniqueness: per (store, product, optional variant).
--
-- These are PARTIAL unique indexes, written by hand because a plain Prisma
-- @@unique([storeId, productId, variantId, batchCode]) is NOT sufficient:
-- PostgreSQL treats NULL as distinct in unique indexes, so multiple
-- product-level batches (variantId IS NULL) sharing the same batchCode would
-- ALL be allowed. Two partial indexes close that hole:
--   1) product-level batches (variantId IS NULL): unique on (storeId, productId, batchCode)
--   2) variant-level batches (variantId IS NOT NULL): unique on (storeId, productId, variantId, batchCode)
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateIndex (partial: product-level batches)
CREATE UNIQUE INDEX "product_batches_store_product_code_key"
  ON "product_batches" ("storeId", "productId", "batchCode")
  WHERE "variantId" IS NULL;

-- CreateIndex (partial: variant-level batches)
CREATE UNIQUE INDEX "product_batches_store_product_variant_code_key"
  ON "product_batches" ("storeId", "productId", "variantId", "batchCode")
  WHERE "variantId" IS NOT NULL;
