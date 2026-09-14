-- Phase 4c2 — expiry reporting & deduplicated notifications.
-- Additive & non-destructive: adds two NotificationType enum values, a nullable
-- notifications.dedupeKey, and a PARTIAL unique index for idempotent sweeps.
-- No stock, batch, sale, allocation, or existing notification row is modified;
-- existing notifications keep dedupeKey = NULL and stay unconstrained.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'EXPIRING_STOCK';
ALTER TYPE "NotificationType" ADD VALUE 'EXPIRED_STOCK';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "dedupeKey" TEXT;

-- Idempotent-notification uniqueness. A plain compound unique would block a
-- user from ever having two null-key notifications (PostgreSQL treats each NULL
-- as distinct, so that is actually allowed — but we make intent explicit with a
-- PARTIAL index that only constrains rows that HAVE a dedupe key). This lets a
-- repeated/concurrent expiry sweep use ON CONFLICT DO NOTHING to skip dupes.
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications" ("userId", "dedupeKey") WHERE "dedupeKey" IS NOT NULL;
