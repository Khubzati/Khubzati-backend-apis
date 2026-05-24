process.env.NODE_ENV = 'test';
process.env.SLA_ALERT_WEBHOOK_URL = process.env.SLA_ALERT_WEBHOOK_URL || 'http://127.0.0.1:9/unreachable-webhook';
process.env.SLA_ALERT_WEBHOOK_SECRET = process.env.SLA_ALERT_WEBHOOK_SECRET || 'qa-secret';
process.env.SLA_ALERT_WEBHOOK_MAX_ATTEMPTS = '2';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');
const {
  ALERT_TYPES,
  evaluateSlaAlerts,
  processPendingAlertDeliveries,
} = require('../src/services/slaAlertService');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const sign = (user) => jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '2h' });

describe('KPI aggregation + SLA alerts + notification queue integration', () => {
  let admin;
  let customer;
  let adminToken;
  let customerToken;
  let bakery;
  let product;

  const created = {
    orders: [],
    orderItems: [],
    kpiRuns: [],
    notifJobs: [],
    slaEvents: [],
    slaDeliveries: [],
  };

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });

    admin = await prisma.user.findUnique({ where: { email: process.env.ADMIN_EMAIL || 'admin@khubzati.com' } });
    customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
    bakery = await prisma.bakery.findUnique({ where: { id: 'test-bakery-id' } });
    product = await prisma.product.findUnique({ where: { id: 'test-bakery-product-id' } });

    adminToken = sign(admin);
    customerToken = sign(customer);
  });

  afterAll(async () => {
    await prisma.slaAlertDeliveryAttempt.deleteMany({ where: { delivery: { eventType: { contains: 'qa' } } } }).catch(() => null);
    await prisma.slaAlertDeadLetter.deleteMany({ where: { eventType: { contains: 'qa' } } }).catch(() => null);
    await prisma.slaAlertDelivery.deleteMany({ where: { eventType: { contains: 'qa' } } }).catch(() => null);
    await prisma.slaAlertEvent.deleteMany({ where: { alertType: { in: Object.values(ALERT_TYPES) } } }).catch(() => null);

    await prisma.notificationDeadLetter.deleteMany({ where: { eventType: { contains: 'qa' } } }).catch(() => null);
    await prisma.notificationJob.deleteMany({ where: { eventType: { contains: 'qa' } } }).catch(() => null);

    await prisma.kpiAggregationRun.deleteMany({ where: { runKey: { contains: 'kpi:' } } }).catch(() => null);

    await prisma.dispatchJob.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.orderCancellationReason.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.inventoryMovement.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.orderItem.deleteMany({ where: { orderId: { in: created.orders } } }).catch(() => null);
    await prisma.order.deleteMany({ where: { id: { in: created.orders } } }).catch(() => null);
  });

  test('KPI backfill + admin consumption + alert lifecycle', async () => {
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);

    const createOrders = [];
    for (let i = 0; i < 8; i += 1) {
      createOrders.push(
        prisma.order.create({
          data: {
            userId: customer.id,
            bakeryId: bakery.id,
            orderNumber: unique('KPI'),
            status: i % 5 === 0 ? 'cancelled' : 'completed',
            orderType: 'delivery',
            deliveryAddressId: 'test-address-id',
            totalAmount: 10 + i,
            paymentMethod: 'cash_on_delivery',
            paymentStatus: 'paid',
            actualDeliveryTime: new Date(Date.now() - (i + 1) * 60 * 1000),
            estimatedDeliveryTime: new Date(Date.now() - (i + 2) * 60 * 1000),
            createdAt: new Date(),
          },
        }),
      );
    }

    const orders = await Promise.all(createOrders);
    orders.forEach((order) => created.orders.push(order.id));

    await Promise.all(
      orders.map((order) =>
        prisma.orderItem
          .create({
            data: {
              orderId: order.id,
              productId: product.id,
              quantity: 1,
              price: order.totalAmount,
              subtotal: order.totalAmount,
            },
          })
          .then((item) => created.orderItems.push(item.id)),
      ),
    );

    const backfill = await request(app)
      .post('/v1/admin/kpis/backfill')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fromDate: todayKey,
        toDate: todayKey,
        force: true,
      });

    expect(backfill.status).toBe(200);
    expect(backfill.body?.data?.run?.status).toBe('completed');

    const kpis = await request(app)
      .get('/v1/admin/kpis/daily?city=all')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(kpis.status).toBe(200);
    expect(Array.isArray(kpis.body?.data?.items)).toBe(true);
    expect(kpis.body.data.items.length).toBeGreaterThan(0);

    const queueLagJob = await prisma.notificationJob.create({
      data: {
        userId: customer.id,
        eventType: 'qa_queue_lag',
        channel: 'in_app',
        title: 'QA queue lag trigger',
        message: 'qa',
        status: 'pending',
        maxAttempts: 2,
        attempts: 0,
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
        nextAttemptAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    });
    created.notifJobs.push(queueLagJob.id);

    const alertEval = await evaluateSlaAlerts({ prisma, now: new Date() });
    expect(alertEval.activeBreaches.length).toBeGreaterThan(0);

    const queueLagBreach = alertEval.activeBreaches.find((item) => item.alertType === ALERT_TYPES.queueLag);
    expect(queueLagBreach).toBeTruthy();

    const activeAlerts = await request(app)
      .get('/v1/admin/alerts/active')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(activeAlerts.status).toBe(200);
    expect(activeAlerts.body?.data?.items?.some((item) => item.alertType === ALERT_TYPES.queueLag)).toBe(true);

    const processOne = await processPendingAlertDeliveries({ prisma, workerId: 'qa-alert-worker', limit: 20 });
    expect(processOne.failed).toBeGreaterThanOrEqual(1);

    await prisma.slaAlertDelivery.updateMany({
      where: { status: 'pending', eventType: { contains: 'breach' } },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });

    const processTwo = await processPendingAlertDeliveries({ prisma, workerId: 'qa-alert-worker', limit: 20 });
    expect(processTwo.failed).toBeGreaterThanOrEqual(1);

    const deadLetters = await prisma.slaAlertDeadLetter.count({
      where: { eventType: { contains: 'breach' } },
    });
    expect(deadLetters).toBeGreaterThan(0);

    const dashboard = await request(app)
      .get('/v1/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(dashboard.status).toBe(200);
    expect(Array.isArray(dashboard.body?.data?.marketplaceHealth?.dailyKpiTrend)).toBe(true);
    expect(Array.isArray(dashboard.body?.data?.marketplaceHealth?.activeBreaches)).toBe(true);
  });

  test('Notification queue retry/dead-letter + metrics/health', async () => {
    const goodJob = await request(app)
      .post('/v1/notifications/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: customer.id,
        eventType: 'qa_notification_good',
        channel: 'in_app',
        title: 'QA good notification',
        message: 'ok',
      });

    expect(goodJob.status).toBe(201);

    const poisonJob = await request(app)
      .post('/v1/notifications/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        eventType: 'qa_notification_poison',
        channel: 'in_app',
        title: 'QA poison notification',
        message: 'this job has no target user',
        maxAttempts: 2,
      });

    expect(poisonJob.status).toBe(201);

    const processFirst = await request(app)
      .post('/v1/notifications/jobs/process')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ workerId: 'qa-notification-worker', limit: 50 });

    expect(processFirst.status).toBe(200);

    await prisma.notificationJob.updateMany({
      where: {
        eventType: 'qa_notification_poison',
        status: 'pending',
      },
      data: {
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });

    const processSecond = await request(app)
      .post('/v1/notifications/jobs/process')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ workerId: 'qa-notification-worker', limit: 50 });

    expect(processSecond.status).toBe(200);

    const poisonDeadLetters = await prisma.notificationDeadLetter.count({
      where: { eventType: 'qa_notification_poison' },
    });
    expect(poisonDeadLetters).toBeGreaterThan(0);

    const metrics = await request(app)
      .get('/v1/notifications/jobs/metrics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(metrics.status).toBe(200);
    expect(metrics.body?.data).toHaveProperty('statusCounts');

    const healthHealthy = await request(app)
      .get('/v1/notifications/jobs/health')
      .set('Authorization', `Bearer ${adminToken}`);
    expect([200, 503]).toContain(healthHealthy.status);

    const staleJob = await prisma.notificationJob.create({
      data: {
        userId: customer.id,
        eventType: 'qa_notification_stale_processing',
        channel: 'in_app',
        title: 'stale',
        message: 'stale',
        status: 'processing',
        lockedAt: new Date(Date.now() - 20 * 60 * 1000),
        lockedBy: 'qa-test',
        attempts: 1,
        maxAttempts: 2,
      },
    });
    created.notifJobs.push(staleJob.id);

    const healthDegraded = await request(app)
      .get('/v1/notifications/jobs/health')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(healthDegraded.status).toBe(503);

    const queueMetrics = await request(app).get('/metrics/queues');
    expect(queueMetrics.status).toBe(200);

    const workerHealth = await request(app).get('/health/workers');
    expect(workerHealth.status).toBe(200);
  });
});
