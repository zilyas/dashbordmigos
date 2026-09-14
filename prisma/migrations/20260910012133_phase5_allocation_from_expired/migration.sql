-- Phase 5 — audit marker for Manager expired-sale overrides.
-- Additive & non-destructive: adds a boolean flag (default false) recording when
-- a sale allocation was drawn from an EXPIRED batch via a Manager override.
-- No stock, batch, sale, or existing allocation row is modified.

-- AlterTable
ALTER TABLE "sale_item_batch_allocations" ADD COLUMN     "fromExpired" BOOLEAN NOT NULL DEFAULT false;
