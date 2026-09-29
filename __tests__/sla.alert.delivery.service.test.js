const {
  processPendingAlertDeliveries,
} = require('../src/services/slaAlertService');

const buildMockPrisma = ({ deliveries }) => {
  const state = {
    deliveries: new Map(deliveries.map((item) => [item.id, { ...item }])),
    attempts: [],
    deadLetters: [],
    audits: [],
  };

  const tx = {
    slaAlertDeliveryAttempt: {
      create: jest.fn(async ({ data }) => {
        state.attempts.push(data);
        return data;
      }),
    },
    slaAlertDelivery: {
      update: jest.fn(async ({ where, data }) => {
        const current = state.deliveries.get(where.id);
        const next = {
          ...current,
          ...data,
          attempts:
            data?.attempts && typeof data.attempts === 'object' && data.attempts.increment
              ? Number(current.attempts || 0) + Number(data.attempts.increment || 0)
              : data?.attempts ?? current.attempts,
        };
        state.deliveries.set(where.id, next);
        return next;
      }),
    },
    slaAlertDeadLetter: {
      create: jest.fn(async ({ data }) => {
        state.deadLetters.push(data);
        return data;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }) => {
        state.audits.push(data);
        return data;
      }),
    },
  };

  return {
    state,
    prisma: {
      slaAlertDelivery: {
        findMany: jest.fn(async () => deliveries),
        updateMany: jest.fn(async ({ where, data }) => {
          const record = state.deliveries.get(where.id);
          if (!record || record.status !== 'pending') return { count: 0 };
          state.deliveries.set(where.id, { ...record, ...data });
          return { count: 1 };
        }),
        findUnique: jest.fn(async ({ where }) => state.deliveries.get(where.id)),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    },
  };
};

describe('sla alert delivery worker', () => {
  const originalFetch = global.fetch;
  const originalWebhookUrl = process.env.SLA_ALERT_WEBHOOK_URL;
  const originalWebhookSecret = process.env.SLA_ALERT_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.SLA_ALERT_WEBHOOK_URL = 'https://alerts.example.com/webhook';
    process.env.SLA_ALERT_WEBHOOK_SECRET = 'top-secret';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.SLA_ALERT_WEBHOOK_URL = originalWebhookUrl;
    process.env.SLA_ALERT_WEBHOOK_SECRET = originalWebhookSecret;
    jest.restoreAllMocks();
  });

  test('delivers webhook and records audit attempt', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'ok',
    }));

    const { prisma, state } = buildMockPrisma({
      deliveries: [
        {
          id: 'delivery-1',
          status: 'pending',
          attempts: 0,
          maxAttempts: 6,
          nextAttemptAt: new Date(Date.now() - 1000),
          eventType: 'queue_lag.breach',
          destinationUrl: 'https://alerts.example.com/webhook',
          payload: { type: 'queue_lag', status: 'active' },
          lockedAt: null,
          lockedBy: null,
        },
      ],
    });

    const result = await processPendingAlertDeliveries({
      prisma,
      workerId: 'jest-sla-worker',
      limit: 5,
    });

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(state.attempts).toHaveLength(1);
    expect(state.deadLetters).toHaveLength(0);
    expect(state.audits.some((entry) => entry.action === 'alerts.webhook.sent')).toBe(true);
  });

  test('moves failed terminal deliveries to dead-letter queue', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    }));

    const { prisma, state } = buildMockPrisma({
      deliveries: [
        {
          id: 'delivery-2',
          status: 'pending',
          attempts: 5,
          maxAttempts: 6,
          nextAttemptAt: new Date(Date.now() - 1000),
          eventType: 'high_refund_ratio.breach',
          destinationUrl: 'https://alerts.example.com/webhook',
          payload: { type: 'high_refund_ratio', status: 'active' },
          lockedAt: null,
          lockedBy: null,
        },
      ],
    });

    const result = await processPendingAlertDeliveries({
      prisma,
      workerId: 'jest-sla-worker',
      limit: 5,
    });

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    expect(state.deadLetters).toHaveLength(1);
    expect(state.deadLetters[0].eventType).toBe('high_refund_ratio.breach');
    expect(state.audits.some((entry) => entry.action === 'alerts.webhook.failed')).toBe(true);
  });
});
