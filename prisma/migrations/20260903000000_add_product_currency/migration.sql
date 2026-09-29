-- Add currency column to products. Defaults to JOD (Jordanian Dinar);
-- the mobile app displays this as "JD".
ALTER TABLE "products" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'JOD';
