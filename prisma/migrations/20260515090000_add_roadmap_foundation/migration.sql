CREATE TABLE IF NOT EXISTS "upload_audit_logs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "owner_type" TEXT,
  "owner_id" TEXT,
  "file_name" TEXT,
  "file_url" TEXT NOT NULL,
  "mime_type" TEXT,
  "file_size" INTEGER,
  "source_route" TEXT,
  "request_id" TEXT,
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "upload_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "user_security_events" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "event_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'recorded',
  "identifier" TEXT,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "request_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_security_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_movements" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "order_id" TEXT,
  "movement_type" TEXT NOT NULL,
  "quantity_before" INTEGER NOT NULL,
  "quantity_delta" INTEGER NOT NULL,
  "quantity_after" INTEGER NOT NULL,
  "reason" TEXT,
  "actor_user_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_cancellation_reasons" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "reason_code" TEXT,
  "reason_text" TEXT,
  "cancelled_by_user_id" TEXT,
  "cancelled_by_role" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_cancellation_reasons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_idempotency_keys" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "order_id" TEXT,
  "processing" BOOLEAN NOT NULL DEFAULT true,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "order_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "api_contract_versions" (
  "id" TEXT NOT NULL,
  "client_name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "min_version" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "api_contract_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "client_error_events" (
  "id" TEXT NOT NULL,
  "client_name" TEXT,
  "app_version" TEXT,
  "endpoint" TEXT,
  "http_status" INTEGER,
  "error_code" TEXT,
  "error_message" TEXT,
  "payload_summary" TEXT,
  "user_id" TEXT,
  "request_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_error_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "delivery_slots" (
  "id" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "zone_code" TEXT,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "capacity" INTEGER NOT NULL DEFAULT 0,
  "reserved_count" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "delivery_slots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "route_zones" (
  "id" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "polygon" JSONB,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "route_zones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "driver_shifts" (
  "id" TEXT NOT NULL,
  "driver_user_id" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "zone_code" TEXT,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "driver_shifts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dispatch_jobs" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "city" TEXT,
  "zone_code" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "assigned_driver_id" TEXT,
  "locked_at" TIMESTAMP(3),
  "locked_by" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sla_due_at" TIMESTAMP(3),
  "assigned_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "dispatch_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "settlement_batches" (
  "id" TEXT NOT NULL,
  "batch_number" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "total_vendors" INTEGER NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'JOD',
  "created_by_user_id" TEXT,
  "approved_by_user_id" TEXT,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "settlement_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "vendor_ledger_entries" (
  "id" TEXT NOT NULL,
  "vendor_type" TEXT NOT NULL,
  "vendor_id" TEXT NOT NULL,
  "order_id" TEXT,
  "payout_request_id" TEXT,
  "settlement_batch_id" TEXT,
  "entry_type" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'JOD',
  "balance_after" DECIMAL(14,2),
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "vendor_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "payout_accounts" (
  "id" TEXT NOT NULL,
  "vendor_type" TEXT NOT NULL,
  "vendor_id" TEXT NOT NULL,
  "account_holder_name" TEXT,
  "bank_name" TEXT,
  "iban" TEXT,
  "account_number_last4" TEXT,
  "provider" TEXT,
  "external_account_id" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "is_verified" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "payout_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "kpi_daily_fact" (
  "id" TEXT NOT NULL,
  "metric_date" DATE NOT NULL,
  "city" TEXT,
  "fill_rate" DECIMAL(7,4),
  "stockout_rate" DECIMAL(7,4),
  "assignment_latency_sec" INTEGER,
  "refund_ratio" DECIMAL(7,4),
  "payout_aging_hours" INTEGER,
  "orders_count" INTEGER,
  "disputes_open_count" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "kpi_daily_fact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_dead_letters" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "user_id" TEXT,
  "event_type" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "payload" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 0,
  "final_error" TEXT,
  "failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "notification_dead_letters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_cancellation_reasons_order_id_key"
ON "order_cancellation_reasons"("order_id");

CREATE UNIQUE INDEX IF NOT EXISTS "order_idempotency_keys_user_id_key_key"
ON "order_idempotency_keys"("user_id", "key");

CREATE UNIQUE INDEX IF NOT EXISTS "api_contract_versions_client_name_version_key"
ON "api_contract_versions"("client_name", "version");

CREATE UNIQUE INDEX IF NOT EXISTS "route_zones_city_code_key"
ON "route_zones"("city", "code");

CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_jobs_order_id_key"
ON "dispatch_jobs"("order_id");

CREATE UNIQUE INDEX IF NOT EXISTS "settlement_batches_batch_number_key"
ON "settlement_batches"("batch_number");

CREATE UNIQUE INDEX IF NOT EXISTS "kpi_daily_fact_metric_date_city_key"
ON "kpi_daily_fact"("metric_date", "city");

CREATE INDEX IF NOT EXISTS "orders_status_created_at_idx"
ON "orders"("status", "created_at");

CREATE INDEX IF NOT EXISTS "orders_payment_status_created_at_idx"
ON "orders"("payment_status", "created_at");

CREATE INDEX IF NOT EXISTS "upload_audit_logs_user_id_uploaded_at_idx"
ON "upload_audit_logs"("user_id", "uploaded_at");

CREATE INDEX IF NOT EXISTS "upload_audit_logs_owner_type_owner_id_uploaded_at_idx"
ON "upload_audit_logs"("owner_type", "owner_id", "uploaded_at");

CREATE INDEX IF NOT EXISTS "user_security_events_user_id_created_at_idx"
ON "user_security_events"("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "user_security_events_event_type_created_at_idx"
ON "user_security_events"("event_type", "created_at");

CREATE INDEX IF NOT EXISTS "user_security_events_identifier_created_at_idx"
ON "user_security_events"("identifier", "created_at");

CREATE INDEX IF NOT EXISTS "inventory_movements_product_id_created_at_idx"
ON "inventory_movements"("product_id", "created_at");

CREATE INDEX IF NOT EXISTS "inventory_movements_order_id_created_at_idx"
ON "inventory_movements"("order_id", "created_at");

CREATE INDEX IF NOT EXISTS "inventory_movements_movement_type_created_at_idx"
ON "inventory_movements"("movement_type", "created_at");

CREATE INDEX IF NOT EXISTS "order_cancellation_reasons_cancelled_by_user_id_created_at_idx"
ON "order_cancellation_reasons"("cancelled_by_user_id", "created_at");

CREATE INDEX IF NOT EXISTS "order_idempotency_keys_order_id_idx"
ON "order_idempotency_keys"("order_id");

CREATE INDEX IF NOT EXISTS "order_idempotency_keys_processing_created_at_idx"
ON "order_idempotency_keys"("processing", "created_at");

CREATE INDEX IF NOT EXISTS "api_contract_versions_client_name_is_active_idx"
ON "api_contract_versions"("client_name", "is_active");

CREATE INDEX IF NOT EXISTS "client_error_events_client_name_created_at_idx"
ON "client_error_events"("client_name", "created_at");

CREATE INDEX IF NOT EXISTS "client_error_events_endpoint_http_status_created_at_idx"
ON "client_error_events"("endpoint", "http_status", "created_at");

CREATE INDEX IF NOT EXISTS "client_error_events_user_id_created_at_idx"
ON "client_error_events"("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "delivery_slots_city_starts_at_is_active_idx"
ON "delivery_slots"("city", "starts_at", "is_active");

CREATE INDEX IF NOT EXISTS "delivery_slots_zone_code_starts_at_idx"
ON "delivery_slots"("zone_code", "starts_at");

CREATE INDEX IF NOT EXISTS "route_zones_city_is_active_idx"
ON "route_zones"("city", "is_active");

CREATE INDEX IF NOT EXISTS "driver_shifts_driver_user_id_starts_at_idx"
ON "driver_shifts"("driver_user_id", "starts_at");

CREATE INDEX IF NOT EXISTS "driver_shifts_city_zone_code_starts_at_idx"
ON "driver_shifts"("city", "zone_code", "starts_at");

CREATE INDEX IF NOT EXISTS "dispatch_jobs_status_next_attempt_at_idx"
ON "dispatch_jobs"("status", "next_attempt_at");

CREATE INDEX IF NOT EXISTS "dispatch_jobs_city_zone_code_status_idx"
ON "dispatch_jobs"("city", "zone_code", "status");

CREATE INDEX IF NOT EXISTS "settlement_batches_status_created_at_idx"
ON "settlement_batches"("status", "created_at");

CREATE INDEX IF NOT EXISTS "vendor_ledger_entries_vendor_type_vendor_id_created_at_idx"
ON "vendor_ledger_entries"("vendor_type", "vendor_id", "created_at");

CREATE INDEX IF NOT EXISTS "vendor_ledger_entries_order_id_idx"
ON "vendor_ledger_entries"("order_id");

CREATE INDEX IF NOT EXISTS "vendor_ledger_entries_payout_request_id_idx"
ON "vendor_ledger_entries"("payout_request_id");

CREATE INDEX IF NOT EXISTS "vendor_ledger_entries_settlement_batch_id_idx"
ON "vendor_ledger_entries"("settlement_batch_id");

CREATE INDEX IF NOT EXISTS "payout_accounts_vendor_type_vendor_id_is_primary_idx"
ON "payout_accounts"("vendor_type", "vendor_id", "is_primary");

CREATE INDEX IF NOT EXISTS "kpi_daily_fact_metric_date_idx"
ON "kpi_daily_fact"("metric_date");

CREATE INDEX IF NOT EXISTS "notification_dead_letters_failed_at_idx"
ON "notification_dead_letters"("failed_at");

CREATE INDEX IF NOT EXISTS "notification_dead_letters_event_type_failed_at_idx"
ON "notification_dead_letters"("event_type", "failed_at");
