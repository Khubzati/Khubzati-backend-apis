process.env.NODE_ENV = 'test';
process.env.SLA_ALERT_WEBHOOK_URL = process.env.SLA_ALERT_WEBHOOK_URL || 'https://alerts.example.com/webhook';
process.env.SLA_ALERT_WEBHOOK_SECRET = process.env.SLA_ALERT_WEBHOOK_SECRET || 'launch-rehearsal-secret';
process.env.SLA_ALERT_WEBHOOK_MAX_ATTEMPTS = '2';
process.env.SLA_ALERT_WEBHOOK_RETRY_BASE_SECONDS = '5';
process.env.SLA_QUEUE_LAG_SECONDS = '1';
process.env.SLA_STUCK_PAYOUT_COUNT = '1';
process.env.SLA_STUCK_PAYOUT_HOURS = '1';
process.env.SLA_AGING_DISPUTE_COUNT = '1';
process.env.SLA_AGING_DISPUTE_HOURS = '1';
process.env.SLA_HIGH_REFUND_RATIO = '0.01';
process.env.SLA_ASSIGNMENT_BREACH_COUNT = '1';
process.env.SLA_DEAD_LETTER_GROWTH_24H = '1';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const app = require('../src/app');
const {
  ALERT_TYPES,
  evaluateSlaAlerts,
  processPendingAlertDeliveries,
} = require('../src/services/slaAlertService');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

describe('SLA alert + worker observability launch rehearsal', () => {
  let admin;
  let customer;
  let bakery;
  let adminToken;

  const created = {
    orders: [],
    disputes: [],
    payouts: [],
    queueJobs: [],
    deadLetters: [],
    dispatchJobs: [],
    kpiRows: [],
    slaEvents: [],
    slaDeliveries: [],
    slaAttempts: [],
    slaDeadLetters: [],
    kpiRuns: [],
  };

  const originalFetch = global.fetch;

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });

    admin = await prisma.user.findUnique({ where: { email: process.env.ADMIN_EMAIL || 'admin@khubzati.com' } });
    customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
    bakery = await prisma.bakery.findUnique({ where: { id: 'test-bakery-id' } });

    adminToken = jwt.sign({ id: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: '2h' });
  });

  afterAll(async () => {
    global.fetch = originalFetch;

    await prisma.slaAlertDeliveryAttempt.deleteMany({ where: { id: { in: created.slaAttempts } } }).catch(() => null);
    await prisma.slaAlertDeadLetter.deleteMany({ where: { id: { in: created.slaDeadLetters } } }).catch(() => null);
    await prisma.slaAlertDelivery.deleteMany({ where: { id: { in: created.slaDeliveries } } }).catch(() => null);
    await prisma.slaAlertEvent.deleteMany({ where: { id: { in: created.slaEvents } } }).catch(() => null);

    await prisma.kpiAggregationRun.deleteMany({ where: { id: { in: created.kpiRuns } } }).catch(() => null);
    await prisma.kpiDailyFact.deleteMany({ where: { id: { in: created.kpiRows } } }).catch(() => null);

    await prisma.notificationDeadLetter.deleteMany({ where: { id: { in: created.deadLetters } } }).catch(() => null);
    await prisma.notificationJob.deleteMany({ where: { id: { in: created.queueJobs } } }).catch(() => null);
    await prisma.dispatchJob.deleteMany({ where: { id: { in: created.dispatchJobs } } }).catch(() => null);
    await prisma.disputeCase.deleteMany({ where: { id: { in: created.disputes } } }).catch(() => null);
    await prisma.payoutRequest.deleteMany({ where: { id: { in: created.payouts } } }).catch(() => null);
    await prisma.order.deleteMany({ where: { id: { in: created.orders } } }).catch(() => null);
  });

  test('triggers all SLA alert types, validates webhook headers, and resolves alerts', async () => {
    const now = new Date();

    const order = await prisma.order.create({
      data: {
        userId: customer.id,
        bakeryId: bakery.id,
        orderNumber: unique('SLA_ORDER'),
        status: 'completed',
        orderType: 'delivery',
        deliveryAddressId: 'test-address-id',
        totalAmount: 15,
        paymentMethod: 'cash_on_delivery',
        paymentStatus: 'paid',
      },
    });
    created.orders.push(order.id);

    const dispute = await prisma.disputeCase.create({
      data: {
        orderId: order.id,
        customerId: customer.id,
        vendorType: 'bakery',
        vendorId: bakery.id,
        subject: 'SLA aging dispute',
        description: 'Aging dispute trigger',
        status: 'open',
        createdAt: new Date(now.getTime() - 4 * 3600 * 1000),
      },
    });
    created.disputes.push(dispute.id);

    const payout = await prisma.payoutRequest.create({
      data: {
        vendorType: 'bakery',
        vendorId: bakery.id,
        requesterUserId: bakery.ownerId,
        amount: 25,
        status: 'requested',
        createdAt: new Date(now.getTime() - 4 * 3600 * 1000),
      },
    });
    created.payouts.push(payout.id);

    const lagJob = await prisma.notificationJob.create({
      data: {
        userId: customer.id,
        eventType: 'sla_queue_lag_seed',
        channel: 'in_app',
        title: 'queue lag seed',
        message: 'queue lag seed',
        status: 'pending',
        attempts: 0,
        maxAttempts: 2,
        createdAt: new Date(now.getTime() - 10 * 60 * 1000),
        nextAttemptAt: new Date(now.getTime() - 10 * 60 * 1000),
      },
    });
    created.queueJobs.push(lagJob.id);

    const dispatch = await prisma.dispatchJob.create({
      data: {
        orderId: order.id,
        city: 'Amman',
        status: 'pending',
        slaDueAt: new Date(now.getTime() - 5 * 60 * 1000),
        createdAt: new Date(now.getTime() - 20 * 60 * 1000),
      },
    });
    created.dispatchJobs.push(dispatch.id);

    const [dl1, dl2] = await Promise.all([
      prisma.notificationDeadLetter.create({
        data: {
          jobId: unique('dead_job_1'),
          eventType: 'dead_letter_growth_seed',
          channel: 'in_app',
          title: 'dead letter seed 1',
          message: 'dead letter seed 1',
          attempts: 2,
          maxAttempts: 2,
          failedAt: new Date(now.getTime() - 60 * 60 * 1000),
        },
      }),
      prisma.notificationDeadLetter.create({
        data: {
          jobId: unique('dead_job_2'),
          eventType: 'dead_letter_growth_seed',
          channel: 'in_app',
          title: 'dead letter seed 2',
          message: 'dead letter seed 2',
          attempts: 2,
          maxAttempts: 2,
          failedAt: new Date(now.getTime() - 30 * 60 * 1000),
        },
      }),
    ]);
    created.deadLetters.push(dl1.id, dl2.id);

    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    const futureMetricDate = new Date(`${tomorrow.toISOString().slice(0, 10)}T00:00:00.000Z`);

    const kpiRow = await prisma.kpiDailyFact.upsert({
      where: {
        metricDate_city: {
          metricDate: futureMetricDate,
          city: 'ALL',
        },
      },
      update: {
        ordersCount: 10,
        refundRatio: 0.2,
        fillRate: 0.8,
        stockoutRate: 0.05,
        cancellationRate: 0.1,
      },
      create: {
        metricDate: futureMetricDate,
        city: 'ALL',
        ordersCount: 10,
        refundRatio: 0.2,
        fillRate: 0.8,
        stockoutRate: 0.05,
        cancellationRate: 0.1,
      },
    });
    created.kpiRows.push(kpiRow.id);

    const evaluation = await evaluateSlaAlerts({ prisma, now });
    const triggered = new Set(evaluation.activeBreaches.map((item) => item.alertType));

    Object.values(ALERT_TYPES).forEach((type) => {
      expect(triggered.has(type)).toBe(true);
    });

    const activeAlertsApi = await request(app)
      .get('/v1/admin/alerts/active')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(activeAlertsApi.status).toBe(200);
    expect(Array.isArray(activeAlertsApi.body?.data?.items)).toBe(true);

    const fetchCalls = [];
    global.fetch = jest.fn(async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => 'ok',
      };
    });

    const deliveryResult = await processPendingAlertDeliveries({
      prisma,
      workerId: 'launch-rehearsal-alert-worker',
      limit: 100,
    });

    expect(deliveryResult.processed).toBeGreaterThanOrEqual(6);
    expect(fetchCalls.length).toBeGreaterThan(0);

    const firstHeaders = fetchCalls[0].options.headers;
    expect(firstHeaders['x-khubzati-signature']).toBeTruthy();
    expect(firstHeaders['x-khubzati-timestamp']).toBeTruthy();
    expect(firstHeaders['x-khubzati-event']).toBeTruthy();

    const createdEvents = await prisma.slaAlertEvent.findMany({
      where: {
        alertType: { in: Object.values(ALERT_TYPES) },
      },
    });
    createdEvents.forEach((event) => created.slaEvents.push(event.id));

    const createdDeliveries = await prisma.slaAlertDelivery.findMany({
      where: {
        alertEventId: { in: createdEvents.map((event) => event.id) },
      },
    });
    createdDeliveries.forEach((delivery) => created.slaDeliveries.push(delivery.id));

    const createdAttempts = await prisma.slaAlertDeliveryAttempt.findMany({
      where: {
        deliveryId: { in: createdDeliveries.map((delivery) => delivery.id) },
      },
    });
    createdAttempts.forEach((attempt) => created.slaAttempts.push(attempt.id));

    // Clear breach conditions to validate resolved transition behavior.
    await prisma.notificationJob.updateMany({
      where: { id: { in: created.queueJobs } },
      data: { status: 'sent' },
    });
    await prisma.payoutRequest.updateMany({
      where: { id: { in: created.payouts } },
      data: { status: 'paid' },
    });
    await prisma.disputeCase.updateMany({
      where: { id: { in: created.disputes } },
      data: { status: 'resolved' },
    });
    await prisma.dispatchJob.updateMany({
      where: { id: { in: created.dispatchJobs } },
      data: {
        status: 'assigned',
        slaDueAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await prisma.notificationDeadLetter.deleteMany({ where: { id: { in: created.deadLetters } } });
    await prisma.kpiDailyFact.updateMany({
      where: { id: { in: created.kpiRows } },
      data: { refundRatio: 0 },
    });

    await prisma.notificationJob.updateMany({
      where: {
        status: {
          in: ['pending', 'processing'],
        },
      },
      data: {
        createdAt: new Date(now.getTime() + 60 * 1000),
        nextAttemptAt: new Date(now.getTime() + 60 * 1000),
      },
    });

    const resolvedEvaluation = await evaluateSlaAlerts({ prisma, now: new Date(now.getTime() + 60 * 1000) });
    expect(resolvedEvaluation.activeBreaches).toHaveLength(0);

    const stillActiveCount = await prisma.slaAlertEvent.count({
      where: {
        alertType: { in: Object.values(ALERT_TYPES) },
        status: 'active',
      },
    });
    expect(stillActiveCount).toBe(0);

    const resolvedCount = await prisma.slaAlertEvent.count({
      where: {
        alertType: { in: Object.values(ALERT_TYPES) },
        status: 'resolved',
      },
    });
    expect(resolvedCount).toBeGreaterThanOrEqual(6);
  });

  test('failed webhook delivery retries with exponential backoff then dead-letters', async () => {
    const delivery = await prisma.slaAlertDelivery.create({
      data: {
        eventType: 'queue_lag.breach',
        destinationUrl: process.env.SLA_ALERT_WEBHOOK_URL,
        payload: {
          type: ALERT_TYPES.queueLag,
          status: 'active',
        },
        status: 'pending',
        attempts: 0,
        maxAttempts: 2,
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });
    created.slaDeliveries.push(delivery.id);

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    }));

    const first = await processPendingAlertDeliveries({
      prisma,
      workerId: 'launch-rehearsal-alert-worker',
      limit: 20,
    });

    expect(first.failed).toBeGreaterThanOrEqual(1);

    const firstState = await prisma.slaAlertDelivery.findUnique({ where: { id: delivery.id } });
    expect(firstState.status).toBe('pending');
    expect(firstState.attempts).toBe(1);

    const retryDelaySec = Math.round((new Date(firstState.nextAttemptAt).getTime() - Date.now()) / 1000);
    expect(retryDelaySec).toBeGreaterThanOrEqual(3);
    expect(retryDelaySec).toBeLessThanOrEqual(8);

    await prisma.slaAlertDelivery.update({
      where: { id: delivery.id },
      data: {
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });

    const second = await processPendingAlertDeliveries({
      prisma,
      workerId: 'launch-rehearsal-alert-worker',
      limit: 20,
    });

    expect(second.failed).toBeGreaterThanOrEqual(1);

    const secondState = await prisma.slaAlertDelivery.findUnique({ where: { id: delivery.id } });
    expect(secondState.status).toBe('failed');
    expect(secondState.attempts).toBe(2);

    const deadLetter = await prisma.slaAlertDeadLetter.findFirst({ where: { deliveryId: delivery.id } });
    expect(deadLetter).toBeTruthy();
    created.slaDeadLetters.push(deadLetter.id);

    const attempts = await prisma.slaAlertDeliveryAttempt.findMany({ where: { deliveryId: delivery.id } });
    attempts.forEach((attempt) => created.slaAttempts.push(attempt.id));
  });

  test('worker and queue observability endpoints return operational state', async () => {
    const backendPackage = require('../package.json');
    expect(backendPackage.scripts?.['start:kpi-worker']).toBe('node ./src/workers/kpi-worker.js');

    const workersHealth = await request(app).get('/health/workers');
    expect(workersHealth.status).toBe(200);
    expect(workersHealth.body?.data).toHaveProperty('kpiWorkerConfigured');

    const queueMetrics = await request(app).get('/metrics/queues');
    expect(queueMetrics.status).toBe(200);
    expect(queueMetrics.body?.data).toHaveProperty('notificationQueue');
    expect(queueMetrics.body?.data).toHaveProperty('alertWebhookQueue');

    const failedRun = await prisma.kpiAggregationRun.create({
      data: {
        runKey: unique('kpi_failed_run'),
        metricDateFrom: new Date('2026-05-01T00:00:00.000Z'),
        metricDateTo: new Date('2026-05-01T00:00:00.000Z'),
        timezone: 'Asia/Amman',
        status: 'failed',
        startedAt: new Date(Date.now() - 1000),
        completedAt: new Date(),
        errorMessage: 'forced failure for health check',
      },
    });
    created.kpiRuns.push(failedRun.id);

    const degraded = await request(app).get('/health/workers/kpi');
    expect(degraded.status).toBe(503);
    expect(degraded.body?.status).toBe('degraded');

    const healthyRun = await prisma.kpiAggregationRun.create({
      data: {
        runKey: unique('kpi_ok_run'),
        metricDateFrom: new Date('2026-05-02T00:00:00.000Z'),
        metricDateTo: new Date('2026-05-02T00:00:00.000Z'),
        timezone: 'Asia/Amman',
        status: 'completed',
        startedAt: new Date(Date.now() + 2000),
        completedAt: new Date(Date.now() + 3000),
        recordsUpserted: 3,
      },
    });
    created.kpiRuns.push(healthyRun.id);

    const healthy = await request(app).get('/health/workers/kpi');
    expect(healthy.status).toBe(200);
    expect(healthy.body?.status).toBe('healthy');
  });
});
