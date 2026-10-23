CREATE TYPE "ModifierSelectionType" AS ENUM ('single', 'multiple');

CREATE TABLE "modifier_groups" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "name_en" TEXT NOT NULL,
  "name_ar" TEXT NOT NULL,
  "selection_type" "ModifierSelectionType" NOT NULL DEFAULT 'single',
  "is_required" BOOLEAN NOT NULL DEFAULT false,
  "min_selections" INTEGER NOT NULL DEFAULT 0,
  "max_selections" INTEGER NOT NULL DEFAULT 1,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_available" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_at" TIMESTAMP(3),
  "updated_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "modifier_options" (
  "id" TEXT NOT NULL,
  "modifier_group_id" TEXT NOT NULL,
  "name_en" TEXT NOT NULL,
  "name_ar" TEXT NOT NULL,
  "price_adjustment" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_available" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_at" TIMESTAMP(3),
  "updated_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "modifier_options_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "modifier_groups_product_id_sort_order_idx"
  ON "modifier_groups"("product_id", "sort_order");
CREATE INDEX "modifier_options_modifier_group_id_sort_order_idx"
  ON "modifier_options"("modifier_group_id", "sort_order");

ALTER TABLE "cart_items" ADD COLUMN "selected_modifiers" JSONB;
ALTER TABLE "order_items" ADD COLUMN "product_name_snapshot" TEXT NOT NULL DEFAULT '';
ALTER TABLE "order_items" ADD COLUMN "product_image_snapshot" TEXT;
ALTER TABLE "order_items" ADD COLUMN "vendor_type_snapshot" "VendorType";
ALTER TABLE "order_items" ADD COLUMN "vendor_id_snapshot" TEXT;
ALTER TABLE "order_items" ADD COLUMN "vendor_name_snapshot" TEXT;
ALTER TABLE "order_items" ADD COLUMN "selected_modifiers_snapshot" JSONB;
ALTER TABLE "order_items" ADD COLUMN "modifier_adjustment_snapshot" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "order_items" ADD COLUMN "unit_price_snapshot" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "order_items" ADD COLUMN "item_total_snapshot" DECIMAL(10,2) NOT NULL DEFAULT 0;
