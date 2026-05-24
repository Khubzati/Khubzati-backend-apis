# Railway Deployment Guide (Khubzati Backend API)

This API is ready to run on Railway as an Express service.

## Runtime behavior

- Start command: `npm start`
- Entrypoint: `node ./src/app.js`
- Port binding: uses `process.env.PORT` (Railway-provided) with fallback to `APP_PORT`
- Health endpoint: `GET /health`

## Worker service (recommended)

Run a dedicated worker service for KPI aggregation and SLA webhooks:

- Start command: `npm run start:kpi-worker`
- Worker entrypoint: `node ./src/workers/kpi-worker.js`
- Worker health from API service: `GET /health/workers` and `GET /health/workers/kpi`

## Required environment variables

Set these in Railway service variables:

- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_SECRET`
- `CORS_ORIGINS`

Recommended:

- `NODE_ENV=production`
- `JWT_EXPIRES_IN=24h`
- `ENABLE_STUB_RESPONSES=false`

## Optional feature flags / integrations

Only set these if you use the related features:

- Payments: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENT_MODE`, `PAYMENT_DEFAULT_CURRENCY`
- Notifications (Firebase): `FIREBASE_SERVICE_ACCOUNT_PATH` or (`FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`)
- SMS (Twilio): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- Cache/queues: `REDIS_URL`
- KPI/alerts:
  - `KPI_TIMEZONE` (default `Asia/Amman`)
  - `SLA_ALERT_WEBHOOK_URL`
  - `SLA_ALERT_WEBHOOK_SECRET`
  - `SLA_ALERT_WEBHOOK_MAX_ATTEMPTS`
  - `SLA_ALERT_WEBHOOK_RETRY_BASE_SECONDS`
  - `SLA_QUEUE_LAG_SECONDS`
  - `SLA_STUCK_PAYOUT_COUNT`
  - `SLA_STUCK_PAYOUT_HOURS`
  - `SLA_AGING_DISPUTE_COUNT`
  - `SLA_AGING_DISPUTE_HOURS`
  - `SLA_HIGH_REFUND_RATIO`
  - `SLA_ASSIGNMENT_BREACH_COUNT`
  - `SLA_DEAD_LETTER_GROWTH_24H`

## Deployment steps

1. Create a new Railway project and connect this repository.
2. Point Railway to the backend root folder: `Khubzati-backend-apis`.
3. Add the required variables above.
4. Deploy.
5. Validate:
   - `GET /health` returns `200` with `{"status":"ok"}`
   - `GET /health/workers` returns queue + worker state
   - `GET /metrics/queues` returns queue status snapshots
   - `GET /` returns API welcome JSON

## Database migrations

Run Prisma migrations against production DB before serving traffic:

```bash
npx prisma migrate deploy
```

You can run this from a Railway shell/job using the same service variables.
