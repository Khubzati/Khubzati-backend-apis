DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_stock_quantity_non_negative'
  ) THEN
    ALTER TABLE "products"
    ADD CONSTRAINT "products_stock_quantity_non_negative"
    CHECK ("stock_quantity" >= 0);
  END IF;
END $$;
