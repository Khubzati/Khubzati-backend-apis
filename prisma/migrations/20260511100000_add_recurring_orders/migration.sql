DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecurringOrderFrequency') THEN
    CREATE TYPE "RecurringOrderFrequency" AS ENUM ('daily');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "recurring_orders" (
  "id" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "bakery_id" TEXT,
  "restaurant_id" TEXT,
  "delivery_address_id" TEXT,
  "source_order_id" TEXT,
  "frequency" "RecurringOrderFrequency" NOT NULL,
  "order_type" "OrderType" NOT NULL DEFAULT 'delivery',
  "payment_method" "PaymentMethod" NOT NULL,
  "payment_provider" "PaymentProvider",
  "special_instructions" TEXT,
  "items_json" JSONB NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "next_run_at" TIMESTAMP(3) NOT NULL,
  "last_run_at" TIMESTAMP(3),
  "last_order_id" TEXT,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "recurring_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "recurring_orders_signature_key"
  ON "recurring_orders"("signature");

CREATE INDEX IF NOT EXISTS "recurring_orders_is_active_next_run_at_idx"
  ON "recurring_orders"("is_active", "next_run_at");

CREATE INDEX IF NOT EXISTS "recurring_orders_user_id_is_active_idx"
  ON "recurring_orders"("user_id", "is_active");

CREATE INDEX IF NOT EXISTS "recurring_orders_bakery_id_is_active_idx"
  ON "recurring_orders"("bakery_id", "is_active");

CREATE INDEX IF NOT EXISTS "recurring_orders_restaurant_id_is_active_idx"
  ON "recurring_orders"("restaurant_id", "is_active");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'recurring_orders_user_id_fkey'
      AND table_name = 'recurring_orders'
  ) THEN
    ALTER TABLE "recurring_orders"
      ADD CONSTRAINT "recurring_orders_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'recurring_orders_bakery_id_fkey'
      AND table_name = 'recurring_orders'
  ) THEN
    ALTER TABLE "recurring_orders"
      ADD CONSTRAINT "recurring_orders_bakery_id_fkey"
      FOREIGN KEY ("bakery_id") REFERENCES "bakeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'recurring_orders_restaurant_id_fkey'
      AND table_name = 'recurring_orders'
  ) THEN
    ALTER TABLE "recurring_orders"
      ADD CONSTRAINT "recurring_orders_restaurant_id_fkey"
      FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'recurring_orders_delivery_address_id_fkey'
      AND table_name = 'recurring_orders'
  ) THEN
    ALTER TABLE "recurring_orders"
      ADD CONSTRAINT "recurring_orders_delivery_address_id_fkey"
      FOREIGN KEY ("delivery_address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;
