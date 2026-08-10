-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "returnedQuantity" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "refundedTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED';
