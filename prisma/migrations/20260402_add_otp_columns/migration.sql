-- Add OTP columns if they don't exist
ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "otp" TEXT,
    ADD COLUMN IF NOT EXISTS "otp_expiry" TIMESTAMP(3);

-- Ensure phone_number is unique (matches Prisma schema @unique)
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_number_key" ON "users"("phone_number");
