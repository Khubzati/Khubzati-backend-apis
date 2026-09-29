const crypto = require('crypto');
const { ALL_CITIES_KEY } = require('./kpiAggregationService');

const ALERT_TYPES = {
  queueLag: 'queue_lag',
  stuckPayouts: 'stuck_payouts',
  agingDisputes: 'aging_disputes',
  highRefundRatio: 'high_refund_ratio',
  deliveryAssignmentSlaBreach: 'delivery_assignment_sla_breach',
  deadLetterGrowth: 'dead_letter_notification_growth',
};

const DEFAULT_THRESHOLDS = {
  [ALERT_TYPES.queueLag]: { thresholdSeconds: Number(process.env.SLA_QUEUE_LAG_SECONDS || 300), cooldownMinutes: 30 },
  [ALERT_TYPES.stuckPayouts]: { thresholdCount: Number(process.env.SLA_STUCK_PAYOUT_COUNT || 5), thresholdNumeric: Number(process.env.SLA_STUCK_PAYOUT_HOURS || 24), cooldownMinutes: 60 },
  [ALERT_TYPES.agingDisputes]: { thresholdCount: Number(process.env.SLA_AGING_DISPUTE_COUNT || 5), thresholdNumeric: Number(process.env.SLA_AGING_DISPUTE_HOURS || 48), cooldownMinutes: 60 },
  [ALERT_TYPES.highRefundRatio]: { thresholdNumeric: Number(process.env.SLA_HIGH_REFUND_RATIO || 0.08), cooldownMinutes: 120 },
  [ALERT_TYPES.deliveryAssignmentSlaBreach]: { thresholdCount: Number(process.env.SLA_ASSIGNMENT_BREACH_COUNT || 1), cooldownMinutes: 30 },
  [ALERT_TYPES.deadLetterGrowth]: { thresholdCount: Number(process.env.SLA_DEAD_LETTER_GROWTH_24H || 20), cooldownMinutes: 30 },
};

const ACTIVE_STATUSES = new Set(['active']);
const OPEN_DISPUTE_STATUSES = ['open', 'under_review', 'vendor_responded'];
const OPEN_PAYOUT_STATUSES = ['requested', 'approved'];

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const hasWebhookConfig = () => String(process.env.SLA_ALERT_WEBHOOK_URL || '').trim().length > 0;

const getWebhookConfig = () => ({
  url: String(process.env.SLA_ALERT_WEBHOOK_URL || '').trim(),
  secret: String(process.env.SLA_ALERT_WEBHOOK_SECRET || '').trim(),
});

const ensureAlertRules = async ({ prisma }) => {
  const upserts = Object.entries(DEFAULT_THRESHOLDS).map(([alertType, defaults]) =>
    prisma.slaAlertRule.upsert({
      where: { alertType },
      update: {
        thresholdNumeric:
          defaults.thresholdNumeric !== undefined && defaults.thresholdNumeric !== null
            ? defaults.thresholdNumeric
            : undefined,
        thresholdCount:
          defaults.thresholdCount !== undefined && defaults.thresholdCount !== null
            ? defaults.thresholdCount
            : undefined,
        thresholdSeconds:
          defaults.thresholdSeconds !== undefined && defaults.thresholdSeconds !== null
            ? defaults.thresholdSeconds
            : undefined,
        cooldownMinutes: toNumber(defaults.cooldownMinutes, 60),
      },
      create: {
        alertType,
        isEnabled: true,
        thresholdNumeric:
          defaults.thresholdNumeric !== undefined && defaults.thresholdNumeric !== null
            ? defaults.thresholdNumeric
            : null,
        thresholdCount:
          defaults.thresholdCount !== undefined && defaults.thresholdCount !== null
            ? defaults.thresholdCount
            : null,
        thresholdSeconds:
          defaults.thresholdSeconds !== undefined && defaults.thresholdSeconds !== null
            ? defaults.thresholdSeconds
            : null,
        cooldownMinutes: toNumber(defaults.cooldownMinutes, 60),
      },
    }),
  );

  await Promise.all(upserts);
  return prisma.slaAlertRule.findMany({ where: { isEnabled: true } });
};

const computeSnapshot = async ({ prisma, now = new Date() }) => {
  const nowMs = now.getTime();

  const [oldestPendingQueueJob, stalePayouts, staleDisputes, latestGlobalKpi, assignmentBreaches, deadLetters24h] =
    await Promise.all([
      prisma.notificationJob.findFirst({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      prisma.payoutRequest.findMany({
        where: {
          status: { in: OPEN_PAYOUT_STATUSES },
        },
        select: {
          id: true,
          createdAt: true,
        },
      }),
      prisma.disputeCase.findMany({
        where: {
          status: { in: OPEN_DISPUTE_STATUSES },
        },
        select: {
          id: true,
          createdAt: true,
        },
      }),
      prisma.kpiDailyFact.findFirst({
        where: { city: ALL_CITIES_KEY },
        orderBy: { metricDate: 'desc' },
      }),
      prisma.dispatchJob.count({
        where: {
          status: { in: ['pending'] },
          slaDueAt: { lt: now },
        },
      }),
      prisma.notificationDeadLetter.count({
        where: {
          failedAt: {
            gte: new Date(nowMs - 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

  const queueLagSeconds = oldestPendingQueueJob
    ? Math.max(0, Math.floor((nowMs - new Date(oldestPendingQueueJob.createdAt).getTime()) / 1000))
    : 0;

  const payoutAgesHours = stalePayouts.map((item) =>
    Math.max(0, (nowMs - new Date(item.createdAt).getTime()) / 3600000),
  );
  const disputeAgesHours = staleDisputes.map((item) =>
    Math.max(0, (nowMs - new Date(item.createdAt).getTime()) / 3600000),
  );

  return {
    [ALERT_TYPES.queueLag]: {
      valueCount: queueLagSeconds,
      valueNumeric: queueLagSeconds,
      summary: `Queue lag is ${queueLagSeconds} seconds`,
      metadata: {
        queueLagSeconds,
      },
    },
    [ALERT_TYPES.stuckPayouts]: {
      valueCount: stalePayouts.length,
      valueNumeric: payoutAgesHours.length > 0 ? Number((payoutAgesHours.reduce((a, b) => a + b, 0) / payoutAgesHours.length).toFixed(2)) : 0,
      summary: `${stalePayouts.length} payout requests are pending`,
      metadata: {
        averageAgingHours: payoutAgesHours.length > 0 ? Number((payoutAgesHours.reduce((a, b) => a + b, 0) / payoutAgesHours.length).toFixed(2)) : 0,
      },
    },
    [ALERT_TYPES.agingDisputes]: {
      valueCount: staleDisputes.length,
      valueNumeric: disputeAgesHours.length > 0 ? Number((disputeAgesHours.reduce((a, b) => a + b, 0) / disputeAgesHours.length).toFixed(2)) : 0,
      summary: `${staleDisputes.length} disputes are still open`,
      metadata: {
        averageAgingHours: disputeAgesHours.length > 0 ? Number((disputeAgesHours.reduce((a, b) => a + b, 0) / disputeAgesHours.length).toFixed(2)) : 0,
      },
    },
    [ALERT_TYPES.highRefundRatio]: {
      valueCount: latestGlobalKpi?.ordersCount || 0,
      valueNumeric: toNumber(latestGlobalKpi?.refundRatio, 0),
      summary: `Refund ratio is ${toNumber(latestGlobalKpi?.refundRatio, 0).toFixed(4)}`,
      metadata: {
        metricDate: latestGlobalKpi?.metricDate || null,
      },
    },
    [ALERT_TYPES.deliveryAssignmentSlaBreach]: {
      valueCount: assignmentBreaches,
      valueNumeric: assignmentBreaches,
      summary: `${assignmentBreaches} dispatch jobs are past SLA`,
      metadata: {
        assignmentBreaches,
      },
    },
    [ALERT_TYPES.deadLetterGrowth]: {
      valueCount: deadLetters24h,
      valueNumeric: deadLetters24h,
      summary: `${deadLetters24h} notification dead letters in the last 24h`,
      metadata: {
        deadLetters24h,
      },
    },
  };
};

const shouldTriggerAlert = ({ rule, snapshot }) => {
  const count = toNumber(snapshot.valueCount, 0);
  const numeric = toNumber(snapshot.valueNumeric, 0);

  if (rule.alertType === ALERT_TYPES.queueLag) {
    return numeric >= toNumber(rule.thresholdSeconds, Number.MAX_SAFE_INTEGER);
  }

  if (rule.alertType === ALERT_TYPES.stuckPayouts || rule.alertType === ALERT_TYPES.agingDisputes) {
    const overCount = count >= toNumber(rule.thresholdCount, Number.MAX_SAFE_INTEGER);
    const overAge = numeric >= toNumber(rule.thresholdNumeric, Number.MAX_SAFE_INTEGER);
    return overCount && overAge;
  }

  if (rule.alertType === ALERT_TYPES.highRefundRatio) {
    return numeric >= toNumber(rule.thresholdNumeric, Number.MAX_SAFE_INTEGER);
  }

  if (rule.alertType === ALERT_TYPES.deliveryAssignmentSlaBreach || rule.alertType === ALERT_TYPES.deadLetterGrowth) {
    return count >= toNumber(rule.thresholdCount, Number.MAX_SAFE_INTEGER);
  }

  return false;
};

const enqueueAlertDelivery = async ({ prisma, eventType, alertEventId = null, payload, metadata = null }) => {
  const webhook = getWebhookConfig();
  if (!webhook.url) return null;

  return prisma.slaAlertDelivery.create({
    data: {
      alertEventId,
      eventType,
      destinationUrl: webhook.url,
      payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: Number(process.env.SLA_ALERT_WEBHOOK_MAX_ATTEMPTS || 6),
      metadata,
    },
  });
};

const upsertAlertEvent = async ({ prisma, rule, snapshot, isBreached, now = new Date() }) => {
  const scopeType = 'global';
  const scopeKey = 'global';

  const [active, resolved] = await Promise.all([
    prisma.slaAlertEvent.findFirst({
      where: {
        alertType: rule.alertType,
        scopeType,
        scopeKey,
        status: 'active',
      },
    }),
    prisma.slaAlertEvent.findFirst({
      where: {
        alertType: rule.alertType,
        scopeType,
        scopeKey,
        status: 'resolved',
      },
    }),
  ]);

  if (isBreached) {
    if (active) {
      const minutesSinceLast = Math.floor((now.getTime() - new Date(active.lastTriggeredAt).getTime()) / 60000);
      const updated = await prisma.slaAlertEvent.update({
        where: { id: active.id },
        data: {
          valueCount: toNumber(snapshot.valueCount, 0),
          valueNumeric: toNumber(snapshot.valueNumeric, 0),
          summary: snapshot.summary,
          lastTriggeredAt: now,
          metadata: snapshot.metadata || null,
        },
      });

      if (minutesSinceLast >= toNumber(rule.cooldownMinutes, 60)) {
        await enqueueAlertDelivery({
          prisma,
          eventType: `${rule.alertType}.breach`,
          alertEventId: updated.id,
          payload: {
            type: rule.alertType,
            status: 'active',
            summary: snapshot.summary,
            valueCount: toNumber(snapshot.valueCount, 0),
            valueNumeric: toNumber(snapshot.valueNumeric, 0),
            metadata: snapshot.metadata || null,
            occurredAt: now.toISOString(),
          },
          metadata: {
            reason: 'cooldown_realert',
          },
        });
      }

      return updated;
    }

    const activated = await prisma.slaAlertEvent.upsert({
      where: {
        alertType_scopeType_scopeKey_status: {
          alertType: rule.alertType,
          scopeType,
          scopeKey,
          status: resolved ? 'resolved' : 'active',
        },
      },
      create: {
        alertType: rule.alertType,
        scopeType,
        scopeKey,
        status: 'active',
        valueCount: toNumber(snapshot.valueCount, 0),
        valueNumeric: toNumber(snapshot.valueNumeric, 0),
        summary: snapshot.summary,
        firstTriggeredAt: now,
        lastTriggeredAt: now,
        metadata: snapshot.metadata || null,
      },
      update: {
        status: 'active',
        valueCount: toNumber(snapshot.valueCount, 0),
        valueNumeric: toNumber(snapshot.valueNumeric, 0),
        summary: snapshot.summary,
        resolvedAt: null,
        firstTriggeredAt: now,
        lastTriggeredAt: now,
        metadata: snapshot.metadata || null,
      },
    });

    await enqueueAlertDelivery({
      prisma,
      eventType: `${rule.alertType}.breach`,
      alertEventId: activated.id,
      payload: {
        type: rule.alertType,
        status: 'active',
        summary: snapshot.summary,
        valueCount: toNumber(snapshot.valueCount, 0),
        valueNumeric: toNumber(snapshot.valueNumeric, 0),
        metadata: snapshot.metadata || null,
        occurredAt: now.toISOString(),
      },
      metadata: {
        reason: 'new_breach',
      },
    });

    return activated;
  }

  if (active) {
    const resolvedEvent = await prisma.slaAlertEvent.update({
      where: { id: active.id },
      data: {
        status: 'resolved',
        resolvedAt: now,
        lastTriggeredAt: now,
        valueCount: toNumber(snapshot.valueCount, 0),
        valueNumeric: toNumber(snapshot.valueNumeric, 0),
        summary: snapshot.summary,
        metadata: snapshot.metadata || null,
      },
    });

    await enqueueAlertDelivery({
      prisma,
      eventType: `${rule.alertType}.resolved`,
      alertEventId: resolvedEvent.id,
      payload: {
        type: rule.alertType,
        status: 'resolved',
        summary: snapshot.summary,
        valueCount: toNumber(snapshot.valueCount, 0),
        valueNumeric: toNumber(snapshot.valueNumeric, 0),
        metadata: snapshot.metadata || null,
        occurredAt: now.toISOString(),
      },
      metadata: {
        reason: 'recovered',
      },
    });
  }

  return null;
};

const evaluateSlaAlerts = async ({ prisma, now = new Date() }) => {
  const rules = await ensureAlertRules({ prisma });
  const snapshotByType = await computeSnapshot({ prisma, now });

  const activeBreaches = [];

  for (const rule of rules) {
    const snapshot = snapshotByType[rule.alertType];
    if (!snapshot) continue;

    const breached = shouldTriggerAlert({ rule, snapshot });
    // eslint-disable-next-line no-await-in-loop
    const event = await upsertAlertEvent({
      prisma,
      rule,
      snapshot,
      isBreached: breached,
      now,
    });

    if (breached) {
      activeBreaches.push({
        alertType: rule.alertType,
        breached,
        valueCount: toNumber(snapshot.valueCount, 0),
        valueNumeric: toNumber(snapshot.valueNumeric, 0),
        thresholdCount: rule.thresholdCount,
        thresholdNumeric: rule.thresholdNumeric,
        thresholdSeconds: rule.thresholdSeconds,
        summary: snapshot.summary,
        eventId: event?.id || null,
      });
    }
  }

  return {
    activeBreaches,
    snapshot: snapshotByType,
    webhookConfigured: hasWebhookConfig(),
  };
};

const claimPendingAlertDeliveries = async ({ prisma, workerId = 'sla-worker', limit = 20 }) => {
  const now = new Date();
  const candidates = await prisma.slaAlertDelivery.findMany({
    where: {
      status: 'pending',
      nextAttemptAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) } }],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: Math.max(1, Math.min(limit, 100)),
  });

  const claimed = [];
  for (const delivery of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const update = await prisma.slaAlertDelivery.updateMany({
        where: {
          id: delivery.id,
          status: 'pending',
          OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) } }],
        },
        data: {
          status: 'processing',
          lockedAt: now,
          lockedBy: workerId,
        },
      });

      if (update.count === 1) {
        // eslint-disable-next-line no-await-in-loop
        const latest = await prisma.slaAlertDelivery.findUnique({ where: { id: delivery.id } });
        if (latest) claimed.push(latest);
      }
    } catch (_) {
      // Another worker claimed the record.
    }
  }

  return claimed;
};

const signPayload = ({ payload, secret }) => {
  const body = JSON.stringify(payload);
  if (!secret) {
    return { body, signature: null, timestamp: null };
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return { body, signature, timestamp };
};

const sendWebhook = async ({ url, payload, secret }) => {
  if (!url) throw new Error('SLA alert webhook URL is not configured');
  if (typeof fetch !== 'function') throw new Error('Global fetch is not available in this runtime');

  const { body, signature, timestamp } = signPayload({ payload, secret });
  const headers = {
    'content-type': 'application/json',
    'x-khubzati-event': String(payload?.type || payload?.eventType || 'sla_alert'),
  };

  if (signature && timestamp) {
    headers['x-khubzati-signature'] = signature;
    headers['x-khubzati-timestamp'] = timestamp;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  const responseBody = await response.text().catch(() => '');
  return {
    ok: response.ok,
    status: response.status,
    body: responseBody,
  };
};

const finalizeAlertDeliverySuccess = async ({ prisma, delivery, httpStatus, responseBody }) => {
  return prisma.$transaction(async (tx) => {
    await tx.slaAlertDeliveryAttempt.create({
      data: {
        deliveryId: delivery.id,
        attemptNumber: toNumber(delivery.attempts, 0) + 1,
        status: 'sent',
        httpStatus,
        responseBody: String(responseBody || '').slice(0, 5000),
      },
    });

    await tx.slaAlertDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'sent',
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        lastHttpStatus: httpStatus,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
      },
    });

    await tx.auditLog.create({
      data: {
        action: 'alerts.webhook.sent',
        entityType: 'sla_alert_delivery',
        entityId: delivery.id,
        metadata: {
          eventType: delivery.eventType,
          httpStatus,
        },
      },
    }).catch(() => null);
  });
};

const finalizeAlertDeliveryFailure = async ({ prisma, delivery, error, httpStatus = null, responseBody = null }) => {
  const attempts = toNumber(delivery.attempts, 0) + 1;
  const maxAttempts = toNumber(delivery.maxAttempts, 6);
  const terminal = attempts >= maxAttempts;
  const backoffSecondsBase = Math.max(5, toNumber(process.env.SLA_ALERT_WEBHOOK_RETRY_BASE_SECONDS, 30));
  const backoffSeconds = Math.min(3600, backoffSecondsBase * 2 ** Math.max(0, attempts - 1));

  const errText = String(error?.message || error || 'Webhook delivery failed').slice(0, 1500);

  return prisma.$transaction(async (tx) => {
    await tx.slaAlertDeliveryAttempt.create({
      data: {
        deliveryId: delivery.id,
        attemptNumber: attempts,
        status: terminal ? 'failed' : 'retrying',
        httpStatus,
        responseBody: String(responseBody || '').slice(0, 5000),
        errorMessage: errText,
      },
    });

    await tx.slaAlertDelivery.update({
      where: { id: delivery.id },
      data: {
        status: terminal ? 'failed' : 'pending',
        attempts,
        lastAttemptAt: new Date(),
        lastHttpStatus: httpStatus,
        lastError: errText,
        nextAttemptAt: terminal ? delivery.nextAttemptAt : new Date(Date.now() + backoffSeconds * 1000),
        lockedAt: null,
        lockedBy: null,
      },
    });

    if (terminal) {
      await tx.slaAlertDeadLetter.create({
        data: {
          deliveryId: delivery.id,
          eventType: delivery.eventType,
          destinationUrl: delivery.destinationUrl,
          payload: delivery.payload || null,
          attempts,
          maxAttempts,
          finalError: errText,
          finalHttpStatus: httpStatus,
          metadata: {
            responseBody: String(responseBody || '').slice(0, 5000),
          },
        },
      });
    }

    await tx.auditLog.create({
      data: {
        action: terminal ? 'alerts.webhook.failed' : 'alerts.webhook.retry_scheduled',
        entityType: 'sla_alert_delivery',
        entityId: delivery.id,
        metadata: {
          eventType: delivery.eventType,
          attempts,
          maxAttempts,
          httpStatus,
          error: errText,
          terminal,
        },
      },
    }).catch(() => null);
  });
};

const processAlertDelivery = async ({ prisma, delivery }) => {
  const webhook = getWebhookConfig();
  const result = await sendWebhook({
    url: delivery.destinationUrl || webhook.url,
    payload: delivery.payload,
    secret: webhook.secret,
  });

  if (!result.ok) {
    const error = new Error(`Webhook responded with status ${result.status}`);
    error.responseStatus = result.status;
    error.responseBody = result.body;
    throw error;
  }

  await finalizeAlertDeliverySuccess({
    prisma,
    delivery,
    httpStatus: result.status,
    responseBody: result.body,
  });

  return result;
};

const processPendingAlertDeliveries = async ({ prisma, workerId = 'sla-worker', limit = 20 }) => {
  if (!hasWebhookConfig()) {
    return {
      processed: 0,
      failed: 0,
      skipped: 0,
      message: 'SLA_ALERT_WEBHOOK_URL is not configured',
      results: [],
    };
  }

  const claimed = await claimPendingAlertDeliveries({ prisma, workerId, limit });
  const results = [];
  let processed = 0;
  let failed = 0;

  for (const delivery of claimed) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await processAlertDelivery({ prisma, delivery });
      results.push({ deliveryId: delivery.id, status: 'sent', httpStatus: result.status });
      processed += 1;
    } catch (error) {
      // eslint-disable-next-line no-await-in-loop
      await finalizeAlertDeliveryFailure({
        prisma,
        delivery,
        error,
        httpStatus: toNumber(error?.responseStatus, null),
        responseBody: error?.responseBody || null,
      });
      results.push({ deliveryId: delivery.id, status: 'failed', error: String(error?.message || error) });
      failed += 1;
    }
  }

  return {
    processed,
    failed,
    skipped: 0,
    message: null,
    results,
  };
};

module.exports = {
  ALERT_TYPES,
  hasWebhookConfig,
  getWebhookConfig,
  ensureAlertRules,
  computeSnapshot,
  evaluateSlaAlerts,
  enqueueAlertDelivery,
  claimPendingAlertDeliveries,
  processPendingAlertDeliveries,
};
