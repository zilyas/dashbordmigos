-- AlterTable
ALTER TABLE "stores" ALTER COLUMN "currency" SET DEFAULT 'MAD';

-- Backfill: migrate existing stores from the old USD default to MAD
-- (platform is being launched for the Moroccan market; confirmed with user).
UPDATE "stores" SET "currency" = 'MAD' WHERE "currency" = 'USD';
