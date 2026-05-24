ALTER TABLE "kpi_daily_fact"
  ADD COLUMN IF NOT EXISTS "on_time_delivery_rate" DECIMAL(7,4),
  ADD COLUMN IF NOT EXISTS "dispute_aging_hours" INTEGER,
  ADD COLUMN IF NOT EXISTS "cancellation_rate" DECIMAL(7,4);

CREATE TABLE IF NOT EXISTS "kpi_aggregation_runs" (
  "id" TEXT NOT NULL,
  "run_key" TEXT NOT NULL,
  "metric_date_from" DATE NOT NULL,
  "metric_date_to" DATE NOT NULL,
  "timezone" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "records_upserted" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "error_message" TEXT,
  "metadata" JSONB,
  CONSTRAINT "kpi_aggregation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sla_alert_rules" (
  "id" TEXT NOT NULL,
  "alert_type" TEXT NOT NULL,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "threshold_numeric" DECIMAL(14,4),
  "threshold_count" INTEGER,
  "threshold_seconds" INTEGER,
  "cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "sla_alert_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sla_alert_events" (
  "id" TEXT NOT NULL,
  "alert_type" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL DEFAULT 'global',
  "scope_key" TEXT NOT NULL DEFAULT 'global',
  "status" TEXT NOT NULL DEFAULT 'active',
  "value_numeric" DECIMAL(14,4),
  "value_count" INTEGER,
  "summary" TEXT,
  "first_triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "sla_alert_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sla_alert_deliveries" (
  "id" TEXT NOT NULL,
  "alert_event_id" TEXT,
  "event_type" TEXT NOT NULL,
  "destination_url" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 6,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "locked_by" TEXT,
  "last_attempt_at" TIMESTAMP(3),
  "last_http_status" INTEGER,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "sla_alert_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sla_alert_delivery_attempts" (
  "id" TEXT NOT NULL,
  "delivery_id" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "http_status" INTEGER,
  "response_body" TEXT,
  "error_message" TEXT,
  "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "sla_alert_delivery_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sla_alert_dead_letters" (
  "id" TEXT NOT NULL,
  "delivery_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "destination_url" TEXT NOT NULL,
  "payload" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 0,
  "final_error" TEXT,
  "final_http_status" INTEGER,
  "failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "sla_alert_dead_letters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "kpi_aggregation_runs_run_key_key"
ON "kpi_aggregation_runs"("run_key");

CREATE UNIQUE INDEX IF NOT EXISTS "sla_alert_rules_alert_type_key"
ON "sla_alert_rules"("alert_type");

CREATE UNIQUE INDEX IF NOT EXISTS "sla_alert_events_alert_type_scope_type_scope_key_status_key"
ON "sla_alert_events"("alert_type", "scope_type", "scope_key", "status");

CREATE INDEX IF NOT EXISTS "kpi_aggregation_runs_status_started_at_idx"
ON "kpi_aggregation_runs"("status", "started_at");

CREATE INDEX IF NOT EXISTS "kpi_aggregation_runs_metric_date_from_metric_date_to_idx"
ON "kpi_aggregation_runs"("metric_date_from", "metric_date_to");

CREATE INDEX IF NOT EXISTS "sla_alert_rules_is_enabled_idx"
ON "sla_alert_rules"("is_enabled");

CREATE INDEX IF NOT EXISTS "sla_alert_events_status_last_triggered_at_idx"
ON "sla_alert_events"("status", "last_triggered_at");

CREATE INDEX IF NOT EXISTS "sla_alert_events_alert_type_status_idx"
ON "sla_alert_events"("alert_type", "status");

CREATE INDEX IF NOT EXISTS "sla_alert_deliveries_status_next_attempt_at_idx"
ON "sla_alert_deliveries"("status", "next_attempt_at");

CREATE INDEX IF NOT EXISTS "sla_alert_deliveries_event_type_status_created_at_idx"
ON "sla_alert_deliveries"("event_type", "status", "created_at");

CREATE INDEX IF NOT EXISTS "sla_alert_delivery_attempts_delivery_id_attempt_number_idx"
ON "sla_alert_delivery_attempts"("delivery_id", "attempt_number");

CREATE INDEX IF NOT EXISTS "sla_alert_delivery_attempts_attempted_at_idx"
ON "sla_alert_delivery_attempts"("attempted_at");

CREATE INDEX IF NOT EXISTS "sla_alert_dead_letters_failed_at_idx"
ON "sla_alert_dead_letters"("failed_at");

CREATE INDEX IF NOT EXISTS "sla_alert_dead_letters_event_type_failed_at_idx"
ON "sla_alert_dead_letters"("event_type", "failed_at");
