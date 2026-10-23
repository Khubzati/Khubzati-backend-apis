CREATE TABLE "onboarding_upload_sessions" (
  "id" TEXT NOT NULL,
  "token_id" TEXT NOT NULL,
  "subject_hash" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "file_url" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "consumed_by_user_id" TEXT,
  "consumed_vendor_id" TEXT,
  "cleanup_attempts" INTEGER NOT NULL DEFAULT 0,
  "cleanup_error" TEXT,
  "cleaned_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "onboarding_upload_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "onboarding_upload_sessions_token_id_key"
  ON "onboarding_upload_sessions"("token_id");
CREATE INDEX "onboarding_upload_sessions_expires_at_consumed_at_cleaned_at_idx"
  ON "onboarding_upload_sessions"("expires_at", "consumed_at", "cleaned_at");
CREATE INDEX "onboarding_upload_sessions_subject_hash_purpose_idx"
  ON "onboarding_upload_sessions"("subject_hash", "purpose");
