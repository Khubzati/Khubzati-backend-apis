const {
  DEFAULT_TIMEZONE,
  normalizeDateKey,
  toTimeZoneDateKey,
  getUtcDayWindowForDateKey,
  enumerateDateKeys,
} = require('./timezoneWindowService');

const ORDER_FULFILLED_STATUSES = new Set(['delivered', 'completed']);
const ORDER_CANCELLED_STATUS = 'cancelled';
const OPEN_DISPUTE_STATUSES = new Set(['open', 'under_review', 'vendor_responded']);
const OPEN_PAYOUT_STATUSES = new Set(['requested', 'approved']);
const STOCKOUT_REASON_CODES = new Set([
  'stockout',
  'out_of_stock',
  'inventory_unavailable',
  'inventory_shortage',
]);
const ALL_CITIES_KEY = 'ALL';

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const safeRatio = (numerator, denominator) => {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  const ratio = toNumber(numerator, 0) / denominator;
  return Number(ratio.toFixed(4));
};

const safeAvg = (values = []) => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const valid = values.map((value) => toNumber(value, NaN)).filter((value) => Number.isFinite(value));
  if (valid.length === 0) return 0;
  const sum = valid.reduce((acc, value) => acc + value, 0);
  return sum / valid.length;
};

const resolveOrderCity = (order) => {
  const rawCity =
    order?.deliveryAddress?.city ||
    order?.bakery?.city ||
    order?.restaurant?.city ||
    order?.city ||
    null;

  const city = String(rawCity || '').trim();
  return city.length > 0 ? city : 'UNKNOWN';
};

const updateMetricBucket = (map, city, updater) => {
  if (!map.has(city)) {
    map.set(city, {
      city,
      ordersCount: 0,
      fulfilledCount: 0,
      cancelledCount: 0,
      deliveredWithEtaCount: 0,
      onTimeCount: 0,
      revenueTotal: 0,
      assignmentLatenciesSec: [],
      stockoutCancellationCount: 0,
      refundsAmount: 0,
    });
  }
  updater(map.get(city));
};

const computeKpiRowsFromData = ({
  dateKey,
  orders = [],
  dispatchJobs = [],
  cancellationReasons = [],
  refunds = [],
  payoutAgingHours = null,
  disputeAgingHours = null,
  disputesOpenCount = null,
}) => {
  const cityBuckets = new Map();
  const globalAssignmentLatencies = [];

  for (const order of orders) {
    const city = resolveOrderCity(order);
    updateMetricBucket(cityBuckets, city, (bucket) => {
      bucket.ordersCount += 1;
      if (ORDER_FULFILLED_STATUSES.has(String(order.status || '').toLowerCase())) {
        bucket.fulfilledCount += 1;
      }
      if (String(order.status || '').toLowerCase() === ORDER_CANCELLED_STATUS) {
        bucket.cancelledCount += 1;
      }

      bucket.revenueTotal += toNumber(order.totalAmount, 0);

      if (order.actualDeliveryTime && order.estimatedDeliveryTime) {
        bucket.deliveredWithEtaCount += 1;
        const actual = new Date(order.actualDeliveryTime).getTime();
        const eta = new Date(order.estimatedDeliveryTime).getTime();
        if (Number.isFinite(actual) && Number.isFinite(eta) && actual <= eta) {
          bucket.onTimeCount += 1;
        }
      }
    });
  }

  for (const job of dispatchJobs) {
    if (!job.assignedAt || !job.createdAt) continue;
    const createdAtMs = new Date(job.createdAt).getTime();
    const assignedAtMs = new Date(job.assignedAt).getTime();
    if (!Number.isFinite(createdAtMs) || !Number.isFinite(assignedAtMs) || assignedAtMs < createdAtMs) continue;

    const city = String(job.city || '').trim() || 'UNKNOWN';
    const latencySec = Math.floor((assignedAtMs - createdAtMs) / 1000);
    globalAssignmentLatencies.push(latencySec);
    updateMetricBucket(cityBuckets, city, (bucket) => {
      bucket.assignmentLatenciesSec.push(latencySec);
    });
  }

  const orderCityMap = new Map(orders.map((order) => [order.id, resolveOrderCity(order)]));

  for (const reason of cancellationReasons) {
    const code = String(reason.reasonCode || '').trim().toLowerCase();
    if (!STOCKOUT_REASON_CODES.has(code)) continue;
    const city = orderCityMap.get(reason.orderId) || 'UNKNOWN';
    updateMetricBucket(cityBuckets, city, (bucket) => {
      bucket.stockoutCancellationCount += 1;
    });
  }

  for (const refund of refunds) {
    const city = orderCityMap.get(refund.orderId) || 'UNKNOWN';
    updateMetricBucket(cityBuckets, city, (bucket) => {
      bucket.refundsAmount += toNumber(refund.amount, 0);
    });
  }

  const cityRows = Array.from(cityBuckets.values()).map((bucket) => {
    const ordersCount = bucket.ordersCount;
    const fillRate = safeRatio(bucket.fulfilledCount, ordersCount);
    const cancellationRate = safeRatio(bucket.cancelledCount, ordersCount);
    const stockoutRate = safeRatio(bucket.stockoutCancellationCount, ordersCount);
    const onTimeDeliveryRate = safeRatio(bucket.onTimeCount, bucket.deliveredWithEtaCount);
    const assignmentLatencySec = Math.round(safeAvg(bucket.assignmentLatenciesSec));
    const refundRatio = safeRatio(bucket.refundsAmount, bucket.revenueTotal);

    return {
      metricDate: new Date(`${dateKey}T00:00:00.000Z`),
      city: bucket.city,
      fillRate,
      stockoutRate,
      assignmentLatencySec: Number.isFinite(assignmentLatencySec) ? assignmentLatencySec : 0,
      onTimeDeliveryRate,
      refundRatio,
      payoutAgingHours: null,
      disputeAgingHours: null,
      cancellationRate,
      ordersCount,
      disputesOpenCount: null,
      metadata: {
        totals: {
          fulfilledCount: bucket.fulfilledCount,
          cancelledCount: bucket.cancelledCount,
          stockoutCancellationCount: bucket.stockoutCancellationCount,
          deliveredWithEtaCount: bucket.deliveredWithEtaCount,
          refundsAmount: Number(bucket.refundsAmount.toFixed(2)),
          revenueTotal: Number(bucket.revenueTotal.toFixed(2)),
        },
      },
    };
  });

  const allOrdersCount = cityRows.reduce((acc, row) => acc + toNumber(row.ordersCount, 0), 0);
  const allFulfilled = cityRows.reduce((acc, row) => acc + toNumber(row.metadata?.totals?.fulfilledCount, 0), 0);
  const allCancelled = cityRows.reduce((acc, row) => acc + toNumber(row.metadata?.totals?.cancelledCount, 0), 0);
  const allStockoutCancelled = cityRows.reduce((acc, row) => acc + toNumber(row.metadata?.totals?.stockoutCancellationCount, 0), 0);
  const allWithEta = cityRows.reduce((acc, row) => acc + toNumber(row.metadata?.totals?.deliveredWithEtaCount, 0), 0);
  const allOnTime = cityRows.reduce((acc, row) => {
    const deliveredWithEta = toNumber(row.metadata?.totals?.deliveredWithEtaCount, 0);
    const onTimeRate = toNumber(row.onTimeDeliveryRate, 0);
    return acc + Math.round(deliveredWithEta * onTimeRate);
  }, 0);
  const allRefundAmount = cityRows.reduce((acc, row) => acc + toNumber(row.metadata?.totals?.refundsAmount, 0), 0);
  const allRevenue = cityRows.reduce((acc, row) => acc + toNumber(row.metadata?.totals?.revenueTotal, 0), 0);

  const globalRow = {
    metricDate: new Date(`${dateKey}T00:00:00.000Z`),
    city: ALL_CITIES_KEY,
    fillRate: safeRatio(allFulfilled, allOrdersCount),
    stockoutRate: safeRatio(allStockoutCancelled, allOrdersCount),
    assignmentLatencySec: Math.round(safeAvg(globalAssignmentLatencies)),
    onTimeDeliveryRate: safeRatio(allOnTime, allWithEta),
    refundRatio: safeRatio(allRefundAmount, allRevenue),
    payoutAgingHours: Number.isFinite(toNumber(payoutAgingHours, NaN)) ? Math.round(toNumber(payoutAgingHours, 0)) : null,
    disputeAgingHours: Number.isFinite(toNumber(disputeAgingHours, NaN)) ? Math.round(toNumber(disputeAgingHours, 0)) : null,
    cancellationRate: safeRatio(allCancelled, allOrdersCount),
    ordersCount: allOrdersCount,
    disputesOpenCount: Number.isFinite(toNumber(disputesOpenCount, NaN)) ? toNumber(disputesOpenCount, 0) : null,
    metadata: {
      totals: {
        fulfilledCount: allFulfilled,
        cancelledCount: allCancelled,
        stockoutCancellationCount: allStockoutCancelled,
        deliveredWithEtaCount: allWithEta,
        refundsAmount: Number(allRefundAmount.toFixed(2)),
        revenueTotal: Number(allRevenue.toFixed(2)),
      },
    },
  };

  return [globalRow, ...cityRows];
};

const fetchDayData = async ({ prisma, startUtc, endUtc }) => {
  const [orders, dispatchJobs, cancellationReasons, refunds, openPayouts, openDisputes] = await Promise.all([
    prisma.order.findMany({
      where: {
        deletedAt: null,
        createdAt: {
          gte: startUtc,
          lt: endUtc,
        },
      },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        estimatedDeliveryTime: true,
        actualDeliveryTime: true,
        deliveryAddress: {
          select: {
            city: true,
          },
        },
        bakery: {
          select: {
            city: true,
          },
        },
        restaurant: {
          select: {
            city: true,
          },
        },
      },
    }),
    prisma.dispatchJob.findMany({
      where: {
        createdAt: {
          gte: startUtc,
          lt: endUtc,
        },
      },
      select: {
        createdAt: true,
        assignedAt: true,
        city: true,
      },
    }),
    prisma.orderCancellationReason.findMany({
      where: {
        createdAt: {
          gte: startUtc,
          lt: endUtc,
        },
      },
      select: {
        orderId: true,
        reasonCode: true,
      },
    }),
    prisma.refundRequest.findMany({
      where: {
        processedAt: {
          gte: startUtc,
          lt: endUtc,
        },
        status: {
          in: ['completed', 'processing'],
        },
      },
      select: {
        orderId: true,
        amount: true,
      },
    }),
    prisma.payoutRequest.findMany({
      where: {
        status: {
          in: Array.from(OPEN_PAYOUT_STATUSES),
        },
        createdAt: {
          lte: endUtc,
        },
      },
      select: {
        createdAt: true,
      },
    }),
    prisma.disputeCase.findMany({
      where: {
        status: {
          in: Array.from(OPEN_DISPUTE_STATUSES),
        },
        createdAt: {
          lte: endUtc,
        },
      },
      select: {
        createdAt: true,
      },
    }),
  ]);

  const payoutAgingHours = safeAvg(
    openPayouts.map((item) => Math.max(0, (endUtc.getTime() - new Date(item.createdAt).getTime()) / 3600000)),
  );

  const disputeAgingHours = safeAvg(
    openDisputes.map((item) => Math.max(0, (endUtc.getTime() - new Date(item.createdAt).getTime()) / 3600000)),
  );

  return {
    orders,
    dispatchJobs,
    cancellationReasons,
    refunds,
    payoutAgingHours,
    disputeAgingHours,
    disputesOpenCount: openDisputes.length,
  };
};

const upsertKpiRows = async ({ prisma, rows = [] }) => {
  let upserted = 0;
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.kpiDailyFact.upsert({
      where: {
        metricDate_city: {
          metricDate: row.metricDate,
          city: row.city,
        },
      },
      update: {
        fillRate: row.fillRate,
        stockoutRate: row.stockoutRate,
        assignmentLatencySec: row.assignmentLatencySec,
        onTimeDeliveryRate: row.onTimeDeliveryRate,
        refundRatio: row.refundRatio,
        payoutAgingHours: row.payoutAgingHours,
        disputeAgingHours: row.disputeAgingHours,
        cancellationRate: row.cancellationRate,
        ordersCount: row.ordersCount,
        disputesOpenCount: row.disputesOpenCount,
        metadata: row.metadata || null,
        updatedAt: new Date(),
      },
      create: {
        metricDate: row.metricDate,
        city: row.city,
        fillRate: row.fillRate,
        stockoutRate: row.stockoutRate,
        assignmentLatencySec: row.assignmentLatencySec,
        onTimeDeliveryRate: row.onTimeDeliveryRate,
        refundRatio: row.refundRatio,
        payoutAgingHours: row.payoutAgingHours,
        disputeAgingHours: row.disputeAgingHours,
        cancellationRate: row.cancellationRate,
        ordersCount: row.ordersCount,
        disputesOpenCount: row.disputesOpenCount,
        metadata: row.metadata || null,
      },
    });
    upserted += 1;
  }
  return upserted;
};

const aggregateKpisForDateKey = async ({ prisma, dateKey, timeZone = DEFAULT_TIMEZONE }) => {
  const { startUtc, endUtc } = getUtcDayWindowForDateKey(dateKey, timeZone);
  const dayData = await fetchDayData({ prisma, startUtc, endUtc });
  const rows = computeKpiRowsFromData({ dateKey, ...dayData });
  const upserted = await upsertKpiRows({ prisma, rows });

  return {
    dateKey,
    window: {
      startUtc,
      endUtc,
      timeZone,
    },
    rows,
    upserted,
  };
};

const aggregateKpisRange = async ({
  prisma,
  fromDate,
  toDate,
  timeZone = DEFAULT_TIMEZONE,
  force = false,
  initiatedBy = null,
  source = 'manual',
}) => {
  const resolvedFrom = normalizeDateKey(fromDate);
  const resolvedTo = normalizeDateKey(toDate);
  const dateKeys = enumerateDateKeys(resolvedFrom, resolvedTo);
  const runKey = `kpi:${resolvedFrom}:${resolvedTo}:${timeZone}`;

  const existingRun = await prisma.kpiAggregationRun.findUnique({
    where: { runKey },
  });

  if (existingRun?.status === 'completed' && !force) {
    return {
      run: existingRun,
      skipped: true,
      message: 'KPI range already aggregated. Use force=true to rerun safely.',
      dates: [],
      totalUpserted: 0,
    };
  }

  const run = await prisma.kpiAggregationRun.upsert({
    where: { runKey },
    create: {
      runKey,
      metricDateFrom: new Date(`${resolvedFrom}T00:00:00.000Z`),
      metricDateTo: new Date(`${resolvedTo}T00:00:00.000Z`),
      timezone: timeZone,
      status: 'running',
      startedAt: new Date(),
      metadata: {
        initiatedBy,
        source,
      },
    },
    update: {
      metricDateFrom: new Date(`${resolvedFrom}T00:00:00.000Z`),
      metricDateTo: new Date(`${resolvedTo}T00:00:00.000Z`),
      timezone: timeZone,
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      errorMessage: null,
      metadata: {
        ...(existingRun?.metadata && typeof existingRun.metadata === 'object' ? existingRun.metadata : {}),
        initiatedBy,
        source,
        rerunCount: toNumber(existingRun?.metadata?.rerunCount, 0) + (existingRun ? 1 : 0),
      },
    },
  });

  try {
    const summaries = [];
    let totalUpserted = 0;

    for (const dateKey of dateKeys) {
      // eslint-disable-next-line no-await-in-loop
      const summary = await aggregateKpisForDateKey({
        prisma,
        dateKey,
        timeZone,
      });
      summaries.push(summary);
      totalUpserted += summary.upserted;
    }

    const completedRun = await prisma.kpiAggregationRun.update({
      where: { id: run.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        recordsUpserted: totalUpserted,
        errorMessage: null,
      },
    });

    return {
      run: completedRun,
      skipped: false,
      dates: summaries,
      totalUpserted,
    };
  } catch (error) {
    await prisma.kpiAggregationRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: String(error?.message || error).slice(0, 1000),
      },
    }).catch(() => null);

    throw error;
  }
};

const aggregatePreviousDay = async ({
  prisma,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
  source = 'worker',
  force = false,
}) => {
  const currentDateKey = toTimeZoneDateKey(now, timeZone);
  const previousDay = new Date(`${currentDateKey}T00:00:00.000Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const previousDateKey = previousDay.toISOString().slice(0, 10);

  return aggregateKpisRange({
    prisma,
    fromDate: previousDateKey,
    toDate: previousDateKey,
    timeZone,
    force,
    initiatedBy: 'kpi-worker',
    source,
  });
};

module.exports = {
  ALL_CITIES_KEY,
  computeKpiRowsFromData,
  aggregateKpisForDateKey,
  aggregateKpisRange,
  aggregatePreviousDay,
};
