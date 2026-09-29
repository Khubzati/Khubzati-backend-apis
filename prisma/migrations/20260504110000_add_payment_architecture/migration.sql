-- Create payment provider enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentProvider') THEN
    CREATE TYPE "PaymentProvider" AS ENUM ('stripe', 'noon', 'cod');
  END IF;
END$$;

-- Extend existing enums for new payment architecture
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'online_card';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'cod_pending';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'cod_collected';

-- Extend orders table with provider/session/payment tracking fields
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "payment_provider" "PaymentProvider",
  ADD COLUMN IF NOT EXISTS "provider_payment_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_session_id" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_amount" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'JOD',
  ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cod_collected_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cod_collected_by" TEXT;

-- Keep historical payment_amount aligned for existing rows
UPDATE "orders"
SET "payment_amount" = "total_amount"
WHERE "payment_amount" IS NULL;

-- Webhook events table for idempotent processing
CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "order_id" TEXT,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_provider_event_id_key"
  ON "webhook_events"("provider", "event_id");

CREATE INDEX IF NOT EXISTS "webhook_events_order_id_idx"
  ON "webhook_events"("order_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'webhook_events_order_id_fkey'
      AND table_name = 'webhook_events'
  ) THEN
    ALTER TABLE "webhook_events"
      ADD CONSTRAINT "webhook_events_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END$$;
