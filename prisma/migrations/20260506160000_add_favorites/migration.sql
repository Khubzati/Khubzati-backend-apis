DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FavoriteTargetType') THEN
    CREATE TYPE "FavoriteTargetType" AS ENUM ('bakery', 'restaurant', 'product');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "favorites" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "target_type" "FavoriteTargetType" NOT NULL,
  "target_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_at" TIMESTAMP(3),
  "updated_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "favorites_user_id_target_type_target_id_key"
  ON "favorites"("user_id", "target_type", "target_id");

CREATE INDEX IF NOT EXISTS "favorites_user_id_target_type_idx"
  ON "favorites"("user_id", "target_type");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'favorites_user_id_fkey'
      AND table_name = 'favorites'
  ) THEN
    ALTER TABLE "favorites"
      ADD CONSTRAINT "favorites_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;
