ALTER TYPE "BakeryStatus" ADD VALUE IF NOT EXISTS 'suspended';
ALTER TYPE "BakeryStatus" ADD VALUE IF NOT EXISTS 'inactive';
ALTER TYPE "RestaurantStatus" ADD VALUE IF NOT EXISTS 'suspended';
ALTER TYPE "RestaurantStatus" ADD VALUE IF NOT EXISTS 'inactive';
