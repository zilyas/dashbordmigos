-- Phase 6: public product/inventory API for external e-commerce storefronts.
--
-- Adds machine credentials (api_clients), order idempotency on sales, and the
-- (storeId, updatedAt) cursor indexes the delta-sync endpoints read from.

-- CreateEnum
CREATE TYPE "ApiClientStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "api_clients" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" "ApiClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "actorUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_keyPrefix_key" ON "api_clients"("keyPrefix");

-- CreateIndex
CREATE INDEX "api_clients_storeId_status_idx" ON "api_clients"("storeId", "status");

-- AddForeignKey
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: attribute API-created sales and de-duplicate retried webhooks.
ALTER TABLE "sales" ADD COLUMN "apiClientId" TEXT;
ALTER TABLE "sales" ADD COLUMN "idempotencyKey" TEXT;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "api_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
-- Postgres treats NULLs as distinct in a unique index, so the many existing POS
-- sales (idempotencyKey IS NULL) never collide with one another; only two API
-- orders replaying the same key do.
CREATE UNIQUE INDEX "sales_storeId_idempotencyKey_key" ON "sales"("storeId", "idempotencyKey");

-- CreateIndex
-- Cursor indexes for GET /api/v1/products?updatedSince= and /api/v1/stock.
CREATE INDEX "products_storeId_updatedAt_idx" ON "products"("storeId", "updatedAt");
CREATE INDEX "product_variants_storeId_updatedAt_idx" ON "product_variants"("storeId", "updatedAt");
