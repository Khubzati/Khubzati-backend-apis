process.env.NODE_ENV = 'test';
require('dotenv').config();

const { execSync } = require('child_process');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const {
  aggregateKpisRange,
  ALL_CITIES_KEY,
} = require('../src/services/kpiAggregationService');
const { getUtcDayWindowForDateKey } = require('../src/services/timezoneWindowService');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';
const KPI_TIMEZONE = process.env.KPI_TIMEZONE || 'Asia/Amman';

const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const n = (value) => Number(value);

describe('KPI formula validation (launch dress rehearsal)', () => {
  let admin;
  let customer;
  let bakery;

  const created = {
    addresses: [],
    orders: [],
    cancellationReasons: [],
    dispatchJobs: [],
    refunds: [],
    payouts: [],
    disputes: [],
    kpiRows: [],
    kpiRuns: [],
  };

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });

    admin = await prisma.user.findUnique({ where: { email: process.env.ADMIN_EMAIL || 'admin@khubzati.com' } });
    customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
    bakery = await prisma.bakery.findUnique({ where: { id: 'test-bakery-id' } });

    expect(admin).toBeTruthy();
    expect(customer).toBeTruthy();
    expect(bakery).toBeTruthy();

    jwt.sign({ id: admin.id, role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
  });

  afterAll(async () => {
    await prisma.kpiAggregationRun.deleteMany({ where: { id: { in: created.kpiRuns } } }).catch(() => null);
    await prisma.kpiDailyFact.deleteMany({ where: { id: { in: created.kpiRows } } }).catch(() => null);

    await prisma.disputeCase.deleteMany({ where: { id: { in: created.disputes } } }).catch(() => null);
    await prisma.payoutRequest.deleteMany({ where: { id: { in: created.payouts } } }).catch(() => null);
    await prisma.refundRequest.deleteMany({ where: { id: { in: created.refunds } } }).catch(() => null);
    await prisma.dispatchJob.deleteMany({ where: { id: { in: created.dispatchJobs } } }).catch(() => null);
    await prisma.orderCancellationReason.deleteMany({ where: { id: { in: created.cancellationReasons } } }).catch(() => null);
    await prisma.order.deleteMany({ where: { id: { in: created.orders } } }).catch(() => null);
    await prisma.address.deleteMany({ where: { id: { in: created.addresses } } }).catch(() => null);
  });

  test('validates KPI formulas exactly and confirms idempotent safe rerun', async () => {
    // Use a historical date window to isolate this suite from other tests that create "today" data.
    const dateKey = '2001-01-15';
    const { startUtc, endUtc } = getUtcDayWindowForDateKey(dateKey, KPI_TIMEZONE);
    const now = new Date(startUtc.getTime() + 8 * 3600 * 1000);

    const ammanAddress = await prisma.address.create({
      data: {
        userId: customer.id,
        addressLine1: 'KPI Amman',
        city: 'Amman',
        postalCode: '11118',
      },
    });
    created.addresses.push(ammanAddress.id);

    const zarqaAddress = await prisma.address.create({
      data: {
        userId: customer.id,
        addressLine1: 'KPI Zarqa',
        city: 'Zarqa',
        postalCode: '13110',
      },
    });
    created.addresses.push(zarqaAddress.id);

    const createdAt = new Date(startUtc.getTime() + 2 * 3600 * 1000);

    const [o1, o2, o3, o4] = await Promise.all([
      prisma.order.create({
        data: {
          userId: customer.id,
          bakeryId: bakery.id,
          orderNumber: unique('KPI_O1'),
          status: 'delivered',
          orderType: 'delivery',
          deliveryAddressId: ammanAddress.id,
          totalAmount: 100,
          paymentMethod: 'cash_on_delivery',
          paymentStatus: 'paid',
          estimatedDeliveryTime: new Date(now.getTime() + 50 * 60 * 1000),
          actualDeliveryTime: new Date(now.getTime() + 45 * 60 * 1000),
          createdAt,
        },
      }),
      prisma.order.create({
        data: {
          userId: customer.id,
          bakeryId: bakery.id,
          orderNumber: unique('KPI_O2'),
          status: 'cancelled',
          orderType: 'delivery',
          deliveryAddressId: ammanAddress.id,
          totalAmount: 50,
          paymentMethod: 'cash_on_delivery',
          paymentStatus: 'cancelled',
          createdAt,
        },
      }),
      prisma.order.create({
        data: {
          userId: customer.id,
          bakeryId: bakery.id,
          orderNumber: unique('KPI_O3'),
          status: 'completed',
          orderType: 'delivery',
          deliveryAddressId: zarqaAddress.id,
          totalAmount: 80,
          paymentMethod: 'cash_on_delivery',
          paymentStatus: 'paid',
          estimatedDeliveryTime: new Date(now.getTime() + 70 * 60 * 1000),
          actualDeliveryTime: new Date(now.getTime() + 80 * 60 * 1000),
          createdAt,
        },
      }),
      prisma.order.create({
        data: {
          userId: customer.id,
          bakeryId: bakery.id,
          orderNumber: unique('KPI_O4'),
          status: 'delivered',
          orderType: 'delivery',
          deliveryAddressId: zarqaAddress.id,
          totalAmount: 20,
          paymentMethod: 'cash_on_delivery',
          paymentStatus: 'paid',
          estimatedDeliveryTime: new Date(now.getTime() + 90 * 60 * 1000),
          actualDeliveryTime: new Date(now.getTime() + 85 * 60 * 1000),
          createdAt,
        },
      }),
    ]);

    created.orders.push(o1.id, o2.id, o3.id, o4.id);

    const cancellation = await prisma.orderCancellationReason.create({
      data: {
        orderId: o2.id,
        reasonCode: 'stockout',
        reasonText: 'Stockout while preparing order',
        cancelledByUserId: customer.id,
        cancelledByRole: 'customer',
        createdAt: new Date(startUtc.getTime() + 3 * 3600 * 1000),
      },
    });
    created.cancellationReasons.push(cancellation.id);

    const [dj1, dj2] = await Promise.all([
      prisma.dispatchJob.create({
        data: {
          orderId: o1.id,
          city: 'Amman',
          status: 'assigned',
          createdAt: new Date(startUtc.getTime() + 4 * 3600 * 1000),
          assignedAt: new Date(startUtc.getTime() + 4 * 3600 * 1000 + 120000),
        },
      }),
      prisma.dispatchJob.create({
        data: {
          orderId: o3.id,
          city: 'Zarqa',
          status: 'assigned',
          createdAt: new Date(startUtc.getTime() + 5 * 3600 * 1000),
          assignedAt: new Date(startUtc.getTime() + 5 * 3600 * 1000 + 300000),
        },
      }),
    ]);
    created.dispatchJobs.push(dj1.id, dj2.id);

    const refund = await prisma.refundRequest.create({
      data: {
        orderId: o2.id,
        requesterUserId: customer.id,
        requesterRole: 'customer',
        amount: 25,
        reason: 'Partial refund KPI validation',
        status: 'completed',
        processedAt: new Date(startUtc.getTime() + 6 * 3600 * 1000),
      },
    });
    created.refunds.push(refund.id);

    const [payoutA, payoutB] = await Promise.all([
      prisma.payoutRequest.create({
        data: {
          vendorType: 'bakery',
          vendorId: bakery.id,
          requesterUserId: bakery.ownerId,
          amount: 30,
          status: 'requested',
          createdAt: new Date(endUtc.getTime() - 10 * 3600 * 1000),
        },
      }),
      prisma.payoutRequest.create({
        data: {
          vendorType: 'bakery',
          vendorId: bakery.id,
          requesterUserId: bakery.ownerId,
          amount: 40,
          status: 'approved',
          createdAt: new Date(endUtc.getTime() - 30 * 3600 * 1000),
        },
      }),
    ]);
    created.payouts.push(payoutA.id, payoutB.id);

    const [d1, d2, d3] = await Promise.all([
      prisma.disputeCase.create({
        data: {
          orderId: o1.id,
          customerId: customer.id,
          vendorType: 'bakery',
          vendorId: bakery.id,
          subject: 'KPI dispute 1',
          description: 'Open dispute sample',
          status: 'open',
          createdAt: new Date(endUtc.getTime() - 12 * 3600 * 1000),
        },
      }),
      prisma.disputeCase.create({
        data: {
          orderId: o3.id,
          customerId: customer.id,
          vendorType: 'bakery',
          vendorId: bakery.id,
          subject: 'KPI dispute 2',
          description: 'Under review dispute sample',
          status: 'under_review',
          createdAt: new Date(endUtc.getTime() - 36 * 3600 * 1000),
        },
      }),
      prisma.disputeCase.create({
        data: {
          orderId: o4.id,
          customerId: customer.id,
          vendorType: 'bakery',
          vendorId: bakery.id,
          subject: 'KPI dispute 3',
          description: 'Vendor responded dispute sample',
          status: 'vendor_responded',
          createdAt: new Date(endUtc.getTime() - 60 * 3600 * 1000),
        },
      }),
    ]);
    created.disputes.push(d1.id, d2.id, d3.id);

    const firstRun = await aggregateKpisRange({
      prisma,
      fromDate: dateKey,
      toDate: dateKey,
      timeZone: KPI_TIMEZONE,
      force: true,
      initiatedBy: admin.id,
      source: 'kpi-formula-validation',
    });

    expect(firstRun.skipped).toBe(false);
    expect(firstRun.run?.status).toBe('completed');
    created.kpiRuns.push(firstRun.run.id);

    const metricDate = new Date(`${dateKey}T00:00:00.000Z`);
    const rows = await prisma.kpiDailyFact.findMany({
      where: { metricDate },
      orderBy: { city: 'asc' },
    });

    rows.forEach((row) => created.kpiRows.push(row.id));

    const global = rows.find((row) => row.city === ALL_CITIES_KEY);
    const amman = rows.find((row) => row.city === 'Amman');
    const zarqa = rows.find((row) => row.city === 'Zarqa');

    expect(global).toBeTruthy();
    expect(amman).toBeTruthy();
    expect(zarqa).toBeTruthy();

    // Formula checks from KPI_DEFINITIONS.md:
    // fill_rate = fulfilled_orders / total_orders = 3/4 = 0.75
    expect(n(global.fillRate)).toBeCloseTo(0.75, 4);
    // stockout_rate = stockout_cancellations / total_orders = 1/4 = 0.25
    expect(n(global.stockoutRate)).toBeCloseTo(0.25, 4);
    // assignment_latency_sec = avg(120, 300) = 210
    expect(global.assignmentLatencySec).toBe(210);
    // on_time_delivery_rate = on_time_deliveries / deliveries_with_eta = 2/3 = 0.6667
    expect(n(global.onTimeDeliveryRate)).toBeCloseTo(2 / 3, 4);
    // refund_ratio = refunded_amount / order_revenue = 25/250 = 0.1
    expect(n(global.refundRatio)).toBeCloseTo(0.1, 4);
    // payout_aging_hours = avg(10, 30) = 20
    expect(global.payoutAgingHours).toBe(20);
    // dispute_aging_hours = avg(12, 36, 60) = 36
    expect(global.disputeAgingHours).toBe(36);
    // cancellation_rate = cancelled_orders / total_orders = 1/4 = 0.25
    expect(n(global.cancellationRate)).toBeCloseTo(0.25, 4);

    expect(global.ordersCount).toBe(4);
    expect(global.disputesOpenCount).toBe(3);

    // city-specific rows exist
    expect(amman.ordersCount).toBe(2);
    expect(zarqa.ordersCount).toBe(2);

    // Safe re-run without force should skip and preserve rows.
    const secondRun = await aggregateKpisRange({
      prisma,
      fromDate: dateKey,
      toDate: dateKey,
      timeZone: KPI_TIMEZONE,
      force: false,
      initiatedBy: admin.id,
      source: 'kpi-formula-validation',
    });

    expect(secondRun.skipped).toBe(true);

    // Force rerun is idempotent by (metric_date, city) upsert.
    const thirdRun = await aggregateKpisRange({
      prisma,
      fromDate: dateKey,
      toDate: dateKey,
      timeZone: KPI_TIMEZONE,
      force: true,
      initiatedBy: admin.id,
      source: 'kpi-formula-validation-rerun',
    });

    expect(thirdRun.skipped).toBe(false);
    created.kpiRuns.push(thirdRun.run.id);

    const globalAfterRerun = await prisma.kpiDailyFact.findUnique({
      where: {
        metricDate_city: {
          metricDate,
          city: ALL_CITIES_KEY,
        },
      },
    });

    expect(n(globalAfterRerun.fillRate)).toBeCloseTo(0.75, 4);
    expect(n(globalAfterRerun.refundRatio)).toBeCloseTo(0.1, 4);
    expect(globalAfterRerun.assignmentLatencySec).toBe(210);
  });
});
