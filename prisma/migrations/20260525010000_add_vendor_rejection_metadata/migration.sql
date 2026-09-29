ALTER TABLE "bakeries"
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3);

ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3);
