-- Records WHAT an idempotency key was first used for, not only that it was used.
--
-- `POST /api/v1/orders` de-duplicates on (store_id, idempotency_key). That
-- catches an honest retry, but it also silently swallows a genuine second order
-- that happens to reuse a key: the caller gets 200 with the FIRST order's
-- totals and no signal that its basket was never recorded. Storing a hash of
-- the request body next to the key lets that case be rejected with
-- 409 idempotency_key_reused instead.
--
-- Nullable and with no backfill: every existing row predates the column, and a
-- null hash is read as "unknown, accept the replay" so no historical API order
-- starts failing. POS sales never carry a key and never carry a hash.

-- AlterTable
ALTER TABLE "sales" ADD COLUMN "idempotencyHash" TEXT;
