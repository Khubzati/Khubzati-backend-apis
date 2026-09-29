require('dotenv').config();

const prisma = require('../lib/prisma');
const { aggregatePreviousDay } = require('../services/kpiAggregationService');
const { evaluateSlaAlerts, processPendingAlertDeliveries, hasWebhookConfig } = require('../services/slaAlertService');
const { DEFAULT_TIMEZONE } = require('../services/timezoneWindowService');


const WORKER_ID = String(process.env.KPI_WORKER_ID || `kpi-worker-${process.pid}`);
const CYCLE_INTERVAL_MS = Math.max(30000, Number(process.env.KPI_WORKER_INTERVAL_MS || 60_000));
const LOCK_KEY = Number(process.env.KPI_WORKER_LOCK_KEY || 918273);
const KPI_TIMEZONE = String(process.env.KPI_TIMEZONE || DEFAULT_TIMEZONE);

let timer = null;

const withAdvisoryLock = async (fn) => {
  const lockRows = await prisma.$queryRawUnsafe('SELECT pg_try_advisory_lock($1) AS acquired', LOCK_KEY);
  const acquired = Array.isArray(lockRows) && lockRows[0]?.acquired === true;
  if (!acquired) return { skipped: true, reason: 'lock-not-acquired' };

  try {
    return await fn();
  } finally {
    await prisma.$queryRawUnsafe('SELECT pg_advisory_unlock($1)', LOCK_KEY).catch(() => null);
  }
};

const runCycle = async () => {
  const cycleStartedAt = new Date();

  const result = await withAdvisoryLock(async () => {
    const kpi = await aggregatePreviousDay({
      prisma,
      now: cycleStartedAt,
      timeZone: KPI_TIMEZONE,
      source: 'kpi-worker',
      force: false,
    });

    const alertEvaluation = await evaluateSlaAlerts({
      prisma,
      now: cycleStartedAt,
    });

    const alertDelivery = await processPendingAlertDeliveries({
      prisma,
      workerId: WORKER_ID,
      limit: Number(process.env.SLA_ALERT_DELIVERY_BATCH_SIZE || 50),
    });

    return {
      kpi,
      alertEvaluation,
      alertDelivery,
    };
  });

  if (result?.skipped) {
    console.log(`[KPIWorker] skipped cycle (${result.reason})`);
    return;
  }

  const kpiRunStatus = result?.kpi?.run?.status || 'unknown';
  const kpiUpserts = result?.kpi?.totalUpserted || 0;
  const activeBreaches = result?.alertEvaluation?.activeBreaches?.length || 0;
  const deliveriesProcessed = result?.alertDelivery?.processed || 0;
  const deliveriesFailed = result?.alertDelivery?.failed || 0;

  console.log(
    `[KPIWorker] run=${kpiRunStatus} upserted=${kpiUpserts} breaches=${activeBreaches} webhook=${hasWebhookConfig()} sent=${deliveriesProcessed} failed=${deliveriesFailed}`,
  );
};

const start = async () => {
  await prisma.$connect();
  console.log(`[KPIWorker] started id=${WORKER_ID} intervalMs=${CYCLE_INTERVAL_MS} timezone=${KPI_TIMEZONE}`);

  await runCycle().catch((error) => {
    console.error('[KPIWorker] initial cycle failed:', error);
  });

  timer = setInterval(() => {
    runCycle().catch((error) => {
      console.error('[KPIWorker] cycle failed:', error);
    });
  }, CYCLE_INTERVAL_MS);
};

const shutdown = async () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((error) => {
  console.error('[KPIWorker] failed to start:', error);
  process.exit(1);
});
