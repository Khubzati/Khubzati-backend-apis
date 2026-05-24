-- AlterTable
ALTER TABLE "bakeries" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'usd';

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'usd';
