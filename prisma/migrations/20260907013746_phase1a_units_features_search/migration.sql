-- AlterTable
ALTER TABLE "products" ADD COLUMN     "allowDecimalQuantity" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unit" TEXT DEFAULT 'piece';

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "features" JSONB;

-- CreateIndex
CREATE INDEX "products_storeId_name_idx" ON "products"("storeId", "name");
