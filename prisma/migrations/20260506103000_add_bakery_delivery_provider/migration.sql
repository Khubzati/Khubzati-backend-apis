DO $$
BEGIN
    CREATE TYPE "DeliveryProvider" AS ENUM ('bakery', 'third_party');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bakeries"
    ADD COLUMN IF NOT EXISTS "delivery_provider" "DeliveryProvider" NOT NULL DEFAULT 'third_party';
