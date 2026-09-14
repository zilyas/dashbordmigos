-- AlterTable
ALTER TABLE "inventory_movements" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "product_variants" ALTER COLUMN "stock" SET DEFAULT 0,
ALTER COLUMN "stock" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "stock" SET DEFAULT 0,
ALTER COLUMN "stock" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "sale_items" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3),
ALTER COLUMN "returnedQuantity" SET DEFAULT 0,
ALTER COLUMN "returnedQuantity" SET DATA TYPE DECIMAL(12,3);

