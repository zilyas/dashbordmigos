-- Phase 4c1 — store timezone for date-only expiry comparisons.
-- Additive & non-destructive: every existing store defaults to UTC. No stock,
-- batch, product, or trackExpiry change; no destructive SQL.

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';
