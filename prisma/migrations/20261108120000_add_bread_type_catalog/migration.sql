-- CreateTable
-- NOTE: `IF NOT EXISTS` guards are intentional. The `bread_type_catalog` table
-- already exists in environments that were provisioned before this migration
-- (prod/dev were created via the legacy Sequelize migration / `prisma db push`).
-- Those environments do not have this migration in `_prisma_migrations`, so a
-- plain `CREATE TABLE` would fail on `prisma migrate deploy` and halt all
-- subsequent migrations. The guards make this a no-op there while still
-- provisioning the table on a fresh database. The column types below match the
-- Prisma model `BreadTypeCatalog` and the live table structure.
CREATE TABLE IF NOT EXISTS "bread_type_catalog" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "english_name" TEXT NOT NULL,
    "arabic_name" TEXT,
    "image_url" TEXT,
    "image_source" TEXT,
    "image_credit" TEXT,
    "description" TEXT,
    "tags" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3),
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "bread_type_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "bread_type_catalog_key_key" ON "bread_type_catalog"("key");

-- Protect the app's vendor and inventory tables from direct Data API access.
-- Backend Prisma connections use the server-side database credentials; public
-- and authenticated Supabase client roles receive no row access without policy.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bakeries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bread_type_catalog" ENABLE ROW LEVEL SECURITY;
