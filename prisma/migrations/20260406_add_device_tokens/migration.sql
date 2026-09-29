-- Create device_tokens table
CREATE TABLE IF NOT EXISTS "device_tokens" (
    "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
    "token" TEXT NOT NULL UNIQUE,
    "platform" TEXT,
    "last_used" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);

-- Index to quickly fetch tokens by user
CREATE INDEX IF NOT EXISTS "device_tokens_user_id_idx" ON "device_tokens"("user_id");
