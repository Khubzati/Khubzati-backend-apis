-- Abort rather than silently enabling constraints over invalid production data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "products"
    WHERE ("bakery_id" IS NULL) = ("restaurant_id" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Cannot enforce product ownership: products with zero or multiple owners exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "carts"
    WHERE "deleted_at" IS NULL
    GROUP BY "user_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce active-cart uniqueness: users with multiple active carts exist';
  END IF;
END $$;

ALTER TABLE "products"
  ADD CONSTRAINT "products_exactly_one_vendor_owner_check"
  CHECK (("bakery_id" IS NOT NULL)::integer + ("restaurant_id" IS NOT NULL)::integer = 1);

CREATE UNIQUE INDEX "carts_one_active_per_user_key"
  ON "carts" ("user_id")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "refund_requests" ADD COLUMN "idempotency_key" TEXT;
ALTER TABLE "payout_requests" ADD COLUMN "idempotency_key" TEXT;
ALTER TABLE "financial_transactions" ADD COLUMN "side_effect_key" TEXT;
ALTER TABLE "vendor_ledger_entries" ADD COLUMN "side_effect_key" TEXT;

CREATE UNIQUE INDEX "refund_requests_requester_user_id_idempotency_key_key"
  ON "refund_requests" ("requester_user_id", "idempotency_key");
CREATE UNIQUE INDEX "payout_requests_vendor_type_vendor_id_idempotency_key_key"
  ON "payout_requests" ("vendor_type", "vendor_id", "idempotency_key");
CREATE UNIQUE INDEX "financial_transactions_side_effect_key_key"
  ON "financial_transactions" ("side_effect_key");
CREATE UNIQUE INDEX "vendor_ledger_entries_side_effect_key_key"
  ON "vendor_ledger_entries" ("side_effect_key");
