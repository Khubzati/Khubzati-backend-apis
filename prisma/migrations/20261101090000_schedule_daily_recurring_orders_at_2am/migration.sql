-- Existing daily templates should follow the same default schedule as new
-- templates: the next 02:00 in the app's Jordan business timezone.
UPDATE "recurring_orders"
SET "next_run_at" = (
  (((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::date + 1) + TIME '02:00')
  AT TIME ZONE 'Asia/Amman'
)
WHERE "is_active" = true
  AND "frequency" = 'daily';
