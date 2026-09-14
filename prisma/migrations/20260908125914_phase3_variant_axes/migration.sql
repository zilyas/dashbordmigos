-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "axisValues" JSONB;

-- CreateTable
CREATE TABLE "variant_axis_definitions" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variant_axis_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "variant_axis_definitions_storeId_idx" ON "variant_axis_definitions"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "variant_axis_definitions_storeId_key_key" ON "variant_axis_definitions"("storeId", "key");

-- AddForeignKey
ALTER TABLE "variant_axis_definitions" ADD CONSTRAINT "variant_axis_definitions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

