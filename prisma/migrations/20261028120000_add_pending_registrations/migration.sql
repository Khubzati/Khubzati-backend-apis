CREATE TABLE "pending_registrations" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT,
    "phone_number" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "otp_hash" TEXT,
    "otp_expiry" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "registered_user_id" TEXT,
    "failed_otp_attempts" INTEGER NOT NULL DEFAULT 0,
    "device_token" TEXT,
    "platform" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_registrations_username_key" ON "pending_registrations"("username");
CREATE UNIQUE INDEX "pending_registrations_email_key" ON "pending_registrations"("email");
CREATE UNIQUE INDEX "pending_registrations_phone_number_key" ON "pending_registrations"("phone_number");
CREATE UNIQUE INDEX "pending_registrations_registered_user_id_key" ON "pending_registrations"("registered_user_id");
