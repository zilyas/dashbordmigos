-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('EN', 'FR');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "locale" "Locale" NOT NULL DEFAULT 'EN';
