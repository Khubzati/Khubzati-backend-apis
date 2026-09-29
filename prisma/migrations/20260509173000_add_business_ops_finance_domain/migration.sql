DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VendorType') THEN
    CREATE TYPE "VendorType" AS ENUM ('bakery', 'restaurant');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionScope') THEN
    CREATE TYPE "CommissionScope" AS ENUM ('global', 'vendor');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RefundStatus') THEN
    CREATE TYPE "RefundStatus" AS ENUM ('pending', 'approved', 'rejected', 'processing', 'completed', 'failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DisputeStatus') THEN
    CREATE TYPE "DisputeStatus" AS ENUM ('open', 'vendor_responded', 'under_review', 'resolved', 'rejected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PayoutStatus') THEN
    CREATE TYPE "PayoutStatus" AS ENUM ('requested', 'approved', 'rejected', 'paid', 'failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FinancialTransactionType') THEN
    CREATE TYPE "FinancialTransactionType" AS ENUM ('order_payment', 'refund', 'payout', 'commission', 'adjustment');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationJobStatus') THEN
    CREATE TYPE "NotificationJobStatus" AS ENUM ('pending', 'processing', 'sent', 'failed');
  END IF;
END$$;

ALTER TABLE "delivery_assignments"
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failure_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_note" TEXT,
  ADD COLUMN IF NOT EXISTS "proof_image_url" TEXT;

CREATE TABLE IF NOT EXISTS "commission_configs" (
  "id" TEXT NOT NULL,
  "scope" "CommissionScope" NOT NULL,
  "vendor_type" "VendorType",
  "vendor_id" TEXT,
  "rate_bps" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_at" TIMESTAMP(3),
  "updated_by" TEXT,
  CONSTRAINT "commission_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_financial_records" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "gross_amount" DECIMAL(10,2) NOT NULL,
  "commission_rate_bps" INTEGER NOT NULL,
  "commission_amount" DECIMAL(10,2) NOT NULL,
  "vendor_net_amount" DECIMAL(10,2) NOT NULL,
  "refunded_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "payout_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "net_platform_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "snapshot" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "order_financial_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "refund_requests" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "requester_user_id" TEXT NOT NULL,
  "requester_role" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "RefundStatus" NOT NULL DEFAULT 'pending',
  "admin_notes" TEXT,
  "provider_refund_id" TEXT,
  "approved_by_user_id" TEXT,
  "approved_at" TIMESTAMP(3),
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dispute_cases" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "vendor_type" "VendorType" NOT NULL,
  "vendor_id" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "evidence_url" TEXT,
  "status" "DisputeStatus" NOT NULL DEFAULT 'open',
  "resolution_note" TEXT,
  "resolved_by_user_id" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "dispute_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dispute_messages" (
  "id" TEXT NOT NULL,
  "dispute_id" TEXT NOT NULL,
  "sender_user_id" TEXT NOT NULL,
  "sender_role" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "attachment_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "payout_requests" (
  "id" TEXT NOT NULL,
  "vendor_type" "VendorType" NOT NULL,
  "vendor_id" TEXT NOT NULL,
  "requester_user_id" TEXT,
  "amount" DECIMAL(10,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'JOD',
  "status" "PayoutStatus" NOT NULL DEFAULT 'requested',
  "reason" TEXT,
  "reviewed_by_user_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "transaction_ref" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "financial_transactions" (
  "id" TEXT NOT NULL,
  "order_id" TEXT,
  "refund_request_id" TEXT,
  "payout_request_id" TEXT,
  "transaction_type" "FinancialTransactionType" NOT NULL,
  "status" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'JOD',
  "provider" TEXT,
  "provider_reference" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_jobs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "event_type" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "payload" JSONB,
  "status" "NotificationJobStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "locked_by" TEXT,
  "sent_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "notification_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "actor_role" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "request_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_financial_records_order_id_key" ON "order_financial_records"("order_id");
CREATE INDEX IF NOT EXISTS "commission_configs_scope_is_active_idx" ON "commission_configs"("scope", "is_active");
CREATE INDEX IF NOT EXISTS "commission_configs_vendor_type_vendor_id_is_active_idx" ON "commission_configs"("vendor_type", "vendor_id", "is_active");
CREATE INDEX IF NOT EXISTS "order_financial_records_created_at_idx" ON "order_financial_records"("created_at");
CREATE INDEX IF NOT EXISTS "refund_requests_order_id_status_idx" ON "refund_requests"("order_id", "status");
CREATE INDEX IF NOT EXISTS "refund_requests_requester_user_id_status_idx" ON "refund_requests"("requester_user_id", "status");
CREATE INDEX IF NOT EXISTS "dispute_cases_order_id_status_idx" ON "dispute_cases"("order_id", "status");
CREATE INDEX IF NOT EXISTS "dispute_cases_vendor_type_vendor_id_status_idx" ON "dispute_cases"("vendor_type", "vendor_id", "status");
CREATE INDEX IF NOT EXISTS "dispute_messages_dispute_id_created_at_idx" ON "dispute_messages"("dispute_id", "created_at");
CREATE INDEX IF NOT EXISTS "payout_requests_vendor_type_vendor_id_status_idx" ON "payout_requests"("vendor_type", "vendor_id", "status");
CREATE INDEX IF NOT EXISTS "payout_requests_status_created_at_idx" ON "payout_requests"("status", "created_at");
CREATE INDEX IF NOT EXISTS "financial_transactions_transaction_type_status_created_at_idx" ON "financial_transactions"("transaction_type", "status", "created_at");
CREATE INDEX IF NOT EXISTS "financial_transactions_order_id_idx" ON "financial_transactions"("order_id");
CREATE INDEX IF NOT EXISTS "notification_jobs_status_next_attempt_at_idx" ON "notification_jobs"("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "notification_jobs_user_id_created_at_idx" ON "notification_jobs"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'order_financial_records_order_id_fkey'
  ) THEN
    ALTER TABLE "order_financial_records"
      ADD CONSTRAINT "order_financial_records_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'refund_requests_order_id_fkey'
  ) THEN
    ALTER TABLE "refund_requests"
      ADD CONSTRAINT "refund_requests_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'refund_requests_requester_user_id_fkey'
  ) THEN
    ALTER TABLE "refund_requests"
      ADD CONSTRAINT "refund_requests_requester_user_id_fkey"
      FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'refund_requests_approved_by_user_id_fkey'
  ) THEN
    ALTER TABLE "refund_requests"
      ADD CONSTRAINT "refund_requests_approved_by_user_id_fkey"
      FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'dispute_cases_order_id_fkey'
  ) THEN
    ALTER TABLE "dispute_cases"
      ADD CONSTRAINT "dispute_cases_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'dispute_cases_customer_id_fkey'
  ) THEN
    ALTER TABLE "dispute_cases"
      ADD CONSTRAINT "dispute_cases_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'dispute_cases_resolved_by_user_id_fkey'
  ) THEN
    ALTER TABLE "dispute_cases"
      ADD CONSTRAINT "dispute_cases_resolved_by_user_id_fkey"
      FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'dispute_messages_dispute_id_fkey'
  ) THEN
    ALTER TABLE "dispute_messages"
      ADD CONSTRAINT "dispute_messages_dispute_id_fkey"
      FOREIGN KEY ("dispute_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'dispute_messages_sender_user_id_fkey'
  ) THEN
    ALTER TABLE "dispute_messages"
      ADD CONSTRAINT "dispute_messages_sender_user_id_fkey"
      FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'payout_requests_requester_user_id_fkey'
  ) THEN
    ALTER TABLE "payout_requests"
      ADD CONSTRAINT "payout_requests_requester_user_id_fkey"
      FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'payout_requests_reviewed_by_user_id_fkey'
  ) THEN
    ALTER TABLE "payout_requests"
      ADD CONSTRAINT "payout_requests_reviewed_by_user_id_fkey"
      FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'financial_transactions_order_id_fkey'
  ) THEN
    ALTER TABLE "financial_transactions"
      ADD CONSTRAINT "financial_transactions_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'financial_transactions_refund_request_id_fkey'
  ) THEN
    ALTER TABLE "financial_transactions"
      ADD CONSTRAINT "financial_transactions_refund_request_id_fkey"
      FOREIGN KEY ("refund_request_id") REFERENCES "refund_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'financial_transactions_payout_request_id_fkey'
  ) THEN
    ALTER TABLE "financial_transactions"
      ADD CONSTRAINT "financial_transactions_payout_request_id_fkey"
      FOREIGN KEY ("payout_request_id") REFERENCES "payout_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'audit_logs_actor_user_id_fkey'
  ) THEN
    ALTER TABLE "audit_logs"
      ADD CONSTRAINT "audit_logs_actor_user_id_fkey"
      FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;
