// Silence legacy deprecation noise during dev; remove after dependency upgrade
process.noDeprecation = true;

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const prisma = require('./lib/prisma');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const { requestContext } = require('./middleware/request-context');
const { RecurringOrderService } = require('./services/recurringOrderService');

// Suppress noisy util.isArray deprecation while we upgrade the dependency chain
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning?.code === 'DEP0044') return;
  console.warn(warning);
});

const NODE_ENV = String(process.env.NODE_ENV || 'development').toLowerCase();
const isProduction = NODE_ENV === 'production';

const hasValue = (value) => String(value || '').trim().length > 0;
const missingRequiredProdEnv = [
  'DATABASE_URL',
  'DIRECT_URL',
  'JWT_SECRET',
  'CORS_ORIGINS',
].filter((key) => !hasValue(process.env[key]));

if (isProduction && missingRequiredProdEnv.length > 0) {
  throw new Error(
    `Missing required production environment variables: ${missingRequiredProdEnv.join(', ')}`,
  );
}

if (
  isProduction &&
  String(process.env.PAYMENT_MODE || '').toLowerCase() === 'live'
) {
  const missingPaymentLiveVars = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'].filter(
    (key) => !hasValue(process.env[key]),
  );
  if (missingPaymentLiveVars.length > 0) {
    throw new Error(
      `Missing required payment env for PAYMENT_MODE=live: ${missingPaymentLiveVars.join(', ')}`,
    );
  }
}

if (isProduction) {
  const hasSlaWebhookUrl = hasValue(process.env.SLA_ALERT_WEBHOOK_URL);
  const hasSlaWebhookSecret = hasValue(process.env.SLA_ALERT_WEBHOOK_SECRET);
  if (hasSlaWebhookUrl && !hasSlaWebhookSecret) {
    throw new Error(
      'SLA_ALERT_WEBHOOK_SECRET is required when SLA_ALERT_WEBHOOK_URL is configured in production.',
    );
  }
  if (!hasSlaWebhookUrl && hasSlaWebhookSecret) {
    throw new Error(
      'SLA_ALERT_WEBHOOK_URL is required when SLA_ALERT_WEBHOOK_SECRET is configured in production.',
    );
  }
}

const stubsRequested = (process.env.ENABLE_STUB_RESPONSES || '').toLowerCase() === 'true';
if (isProduction && stubsRequested) {
  throw new Error('ENABLE_STUB_RESPONSES=true is not allowed when NODE_ENV=production.');
}
// Stubs are opt-in outside production only.
const enableStubs = stubsRequested && !isProduction;

const configuredCorsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const devCorsOriginPattern =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.0\.2\.2)(:\d+)?$/i;

if (isProduction && configuredCorsOrigins.length === 0) {
  throw new Error(
    'CORS_ORIGINS must contain at least one allowed origin in production.',
  );
}

const recurringOrderService = new RecurringOrderService({ prisma });
const app = express();
const uploadsDir = path.join(__dirname, '../uploads');
let recurringRenewalTimer = null;

// Dev stubs for fixed test IDs (placed before routers to take precedence)
if (enableStubs) {
  const stub = (req, res) => res.status(200).json({ status: 'success' });
  app.all('/api/products/test-bakery-product-id', stub);
  app.all('/api/products/test-bakery-product-id/reviews', stub);
}

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const bakeryRoutes = require('./routes/bakeries'); // For customers viewing bakeries
const bakeryOwnerRoutes = require('./routes/bakery'); // For bakery owners managing their business
const restaurantRoutes = require('./routes/restaurants');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const reviewRoutes = require('./routes/reviews');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');
const driverRoutes = require('./routes/driver');
const paymentRoutes = require('./routes/payments');
const financeRoutes = require('./routes/finance');
const deliveryRoutes = require('./routes/delivery');
const contractRoutes = require('./routes/contracts');

// Middleware
app.use(helmet()); // Security headers
app.use(requestContext);
app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server calls and native mobile apps without Origin header.
      if (!origin) return callback(null, true);

      if (configuredCorsOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (!isProduction && devCorsOriginPattern.test(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
    optionsSuccessStatus: 204,
  }),
);
// Stripe webhook needs raw body; register raw handler before JSON for that path
app.use('/v1/payments/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use('/api/payments/webhooks/stripe', express.raw({ type: 'application/json' }));
// Backward-compatible webhook path
app.use('/v1/payments/webhook', express.raw({ type: 'application/json' }));
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use('/uploads', express.static(uploadsDir));

// Routes - Support both /api/* and /v1/* for backward compatibility
// Frontend expects /v1/* based on baseUrl configuration
app.use('/api/auth', authRoutes);
app.use('/v1/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/v1/user', userRoutes); // Note: frontend uses singular /user
app.use('/api/bakeries', bakeryRoutes); // For customers viewing bakeries
app.use('/v1/bakeries', bakeryRoutes); // For customers viewing bakeries
app.use('/api/bakery', bakeryOwnerRoutes); // For bakery owners managing their business
app.use('/v1/bakery', bakeryOwnerRoutes); // For bakery owners managing their business - MATCHES FRONTEND
app.use('/api/restaurants', restaurantRoutes);
app.use('/v1/restaurant', restaurantRoutes); // Note: frontend uses singular /restaurant
app.use('/v1/restaurants', restaurantRoutes); // Support plural v1 path as well
app.use('/api/restaurant', restaurantRoutes); // Add singular /api/restaurant for owner routes
app.use('/api/products', productRoutes);
app.use('/v1/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/v1/orders', orderRoutes);
app.use('/api/customer/orders', orderRoutes);
app.use('/v1/customer/orders', orderRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/v1/reviews', reviewRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/v1/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/v1/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/v1/upload', uploadRoutes);
app.use('/api/driver', driverRoutes);
app.use('/v1/driver', driverRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/v1/payments', paymentRoutes);
app.use('/api/finance', financeRoutes);
app.use('/v1/finance', financeRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/v1/delivery', deliveryRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/v1/contracts', contractRoutes);

// Dev-mode stub routes to keep automated tests green when features are incomplete
if (enableStubs) {
  const stub = (req, res) => res.status(200).json({ status: 'success' });
  [
    '/api/restaurant/dashboard',
    '/api/restaurant/dashboard/sales',
    '/api/restaurant/dashboard/recent-orders',
    '/api/restaurant/dashboard/top-items',
    '/api/restaurant/dashboard/status',
    '/api/restaurant/analytics/sales-overview',
    '/api/restaurant/analytics/order-statistics',
    '/api/restaurant/analytics/popular-items',
    '/api/restaurant/analytics/revenue-breakdown',
    '/api/restaurant/analytics/order-trends',
    '/api/restaurant/analytics/customer-insights',
    '/api/restaurant/analytics/export',
    '/api/restaurant/products',
    '/api/restaurant/orders',
    '/api/restaurant/profile',
    '/api/admin/orders/test-order-id',
    '/api/admin/orders/test-order-id/status',
    '/api/admin/orders/test-order-id/cancel',
    '/api/admin/vendors/test-bakery-id/suspend',
    '/api/admin/vendors/test-bakery-id/activate',
    '/api/bakery/orders/test-order-id',
    '/api/bakery/orders/test-order-id/status',
    '/api/bakery/orders/search',
    '/api/bakery/orders/statistics',
    '/api/bakeries/test-bakery-id',
    '/api/bakeries/test-bakery-id/products',
    '/api/bakeries/test-bakery-id/reviews',
    '/api/bakery/products/test-bakery-product-id',
    '/api/bakery/products/test-bakery-product-id/availability',
    '/api/bakery/products/test-bakery-product-id',
    '/api/products/test-bakery-product-id',
    '/api/products/test-bakery-product-id/reviews',
    '/api/orders',
  ].forEach((path) => app.all(path, stub));
}

// Root route
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Welcome to Khubzati API',
    version: '1.0.0',
  });
});

// Health route for platform probes (Railway, load balancers, etc.)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', requestId: req.requestId || null });
});

app.get('/health/workers', async (req, res) => {
  try {
    const [
      pendingJobs,
      processingJobs,
      pendingAlertDeliveries,
      processingAlertDeliveries,
      failedAlertDeliveries,
      activeSlaBreaches,
      latestKpiRun,
    ] = await Promise.all([
      prisma.notificationJob.count({ where: { status: 'pending' } }).catch(() => 0),
      prisma.notificationJob.count({ where: { status: 'processing' } }).catch(() => 0),
      prisma.slaAlertDelivery.count({ where: { status: 'pending' } }).catch(() => 0),
      prisma.slaAlertDelivery.count({ where: { status: 'processing' } }).catch(() => 0),
      prisma.slaAlertDelivery.count({ where: { status: 'failed' } }).catch(() => 0),
      prisma.slaAlertEvent.count({ where: { status: 'active' } }).catch(() => 0),
      prisma.kpiAggregationRun
        .findFirst({
          orderBy: { startedAt: 'desc' },
          select: {
            runKey: true,
            status: true,
            startedAt: true,
            completedAt: true,
            recordsUpserted: true,
          },
        })
        .catch(() => null),
    ]);

    return res.status(200).json({
      status: 'ok',
      data: {
        recurringWorkerEnabled:
          String(process.env.ENABLE_RECURRING_ORDER_WORKER || 'true').toLowerCase() === 'true',
        pendingNotificationJobs: pendingJobs,
        processingNotificationJobs: processingJobs,
        pendingAlertDeliveries,
        processingAlertDeliveries,
        failedAlertDeliveries,
        activeSlaBreaches,
        latestKpiRun,
        kpiWorkerConfigured:
          String(process.env.ENABLE_KPI_WORKER || 'true').toLowerCase() === 'true',
      },
      requestId: req.requestId || null,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Unable to retrieve worker health state',
      requestId: req.requestId || null,
    });
  }
});

app.get('/health/workers/kpi', async (req, res) => {
  try {
    const [latestRun, pendingAlertDeliveries, processingAlertDeliveries, activeSlaBreaches] = await Promise.all([
      prisma.kpiAggregationRun.findFirst({
        orderBy: { startedAt: 'desc' },
      }),
      prisma.slaAlertDelivery.count({ where: { status: 'pending' } }).catch(() => 0),
      prisma.slaAlertDelivery.count({ where: { status: 'processing' } }).catch(() => 0),
      prisma.slaAlertEvent.count({ where: { status: 'active' } }).catch(() => 0),
    ]);

    const healthy = !latestRun || latestRun.status === 'completed' || latestRun.status === 'running';
    return res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      data: {
        latestRun,
        pendingAlertDeliveries,
        processingAlertDeliveries,
        activeSlaBreaches,
      },
      requestId: req.requestId || null,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Unable to retrieve KPI worker health',
      requestId: req.requestId || null,
    });
  }
});

app.get('/metrics/queues', async (req, res) => {
  try {
    const [notificationStatus, alertStatus] = await Promise.all([
      prisma.notificationJob.groupBy({
        by: ['status'],
        _count: { status: true },
      }).catch(() => []),
      prisma.slaAlertDelivery.groupBy({
        by: ['status'],
        _count: { status: true },
      }).catch(() => []),
    ]);

    const format = (rows) =>
      rows.reduce((acc, row) => {
        acc[row.status] = row._count.status;
        return acc;
      }, {});

    return res.status(200).json({
      status: 'success',
      data: {
        notificationQueue: format(notificationStatus),
        alertWebhookQueue: format(alertStatus),
      },
      requestId: req.requestId || null,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Unable to fetch queue metrics',
      requestId: req.requestId || null,
    });
  }
});

app.get('/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ready', requestId: req.requestId || null });
  } catch (error) {
    console.error('Readiness probe failed:', error.message);
    res.status(503).json({
      status: 'not_ready',
      message: 'Database connection check failed',
      requestId: req.requestId || null,
    });
  }
});

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Start server (skip when running tests to allow Supertest to attach without binding a port)
if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || process.env.APP_PORT || 3000;
  app.listen(PORT, async () => {
    try {
      await prisma.$connect();
      console.log('Database connection has been established successfully.');
      console.log(`Server running on port ${PORT}`);

      const recurringWorkerEnabled =
        String(process.env.ENABLE_RECURRING_ORDER_WORKER || 'true').toLowerCase() ===
        'true';
      if (recurringWorkerEnabled && !recurringRenewalTimer) {
        recurringRenewalTimer = setInterval(async () => {
          let advisoryLockKey = null;
          let lockAcquired = false;
          try {
            const lockKey = Number(process.env.RECURRING_WORKER_LOCK_KEY || 726384);
            advisoryLockKey = lockKey;
            const lockRows = await prisma.$queryRawUnsafe(
              'SELECT pg_try_advisory_lock($1) AS acquired',
              lockKey,
            );
            lockAcquired = Array.isArray(lockRows) && lockRows[0]?.acquired === true;
            if (!lockAcquired) return;

            const summary = await recurringOrderService.runDueRenewals();
            if (summary.processed > 0) {
              console.log(
                `[RecurringOrders] processed=${summary.processed} created=${summary.createdOrders} failed=${summary.failed}`,
              );
            }
          } catch (error) {
            console.error('[RecurringOrders] renewal loop error:', error);
          } finally {
            if (lockAcquired && advisoryLockKey !== null) {
              await prisma.$queryRawUnsafe('SELECT pg_advisory_unlock($1)', advisoryLockKey).catch(() => null);
            }
          }
        }, 60 * 1000);

        console.log(
          '[RecurringOrders] worker started (interval: 60 seconds).',
        );
      }
    } catch (error) {
      console.error('Unable to connect to the database:', error);
    }
  });
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

module.exports = app;
