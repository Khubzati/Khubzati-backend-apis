const { notifyUser } = require('./notificationDispatchService');

const DEFAULT_MAX_ATTEMPTS = 3;

const enqueueNotificationJob = async ({
  prisma,
  userId = null,
  eventType,
  channel = 'in_app',
  title,
  message,
  payload = {},
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}) => {
  return prisma.notificationJob.create({
    data: {
      userId,
      eventType,
      channel,
      title,
      message,
      payload,
      maxAttempts,
      status: 'pending',
    },
  });
};

const claimPendingJobs = async ({
  prisma,
  workerId = 'worker-default',
  limit = 20,
}) => {
  const now = new Date();
  const jobs = await prisma.notificationJob.findMany({
    where: {
      status: 'pending',
      nextAttemptAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) } }],
    },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(limit, 100)),
  });

  const claimed = [];
  for (const job of jobs) {
    try {
      const claimResult = await prisma.notificationJob.updateMany({
        where: {
          id: job.id,
          status: 'pending',
          OR: [
            { lockedAt: null },
            { lockedAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) } },
          ],
        },
        data: {
          status: 'processing',
          lockedAt: now,
          lockedBy: workerId,
        },
      });
      if (claimResult.count === 1) {
        const updated = await prisma.notificationJob.findUnique({ where: { id: job.id } });
        if (updated) claimed.push(updated);
      }
    } catch (_) {
      // Another worker may have claimed it.
    }
  }
  return claimed;
};

const markJobSuccess = async ({ prisma, jobId }) => {
  return prisma.notificationJob.update({
    where: { id: jobId },
    data: {
      status: 'sent',
      sentAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
};

const markJobFailure = async ({ prisma, job, error }) => {
  const attempts = (job.attempts || 0) + 1;
  const terminalFailure = attempts >= (job.maxAttempts || DEFAULT_MAX_ATTEMPTS);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.notificationJob.update({
      where: { id: job.id },
      data: {
        attempts,
        status: terminalFailure ? 'failed' : 'pending',
        nextAttemptAt: terminalFailure ? job.nextAttemptAt : new Date(Date.now() + attempts * 60 * 1000),
        lastError: String(error?.message || error || 'Notification dispatch failed').slice(0, 1000),
        lockedAt: null,
        lockedBy: null,
      },
    });

    if (terminalFailure) {
      await tx.notificationDeadLetter.create({
        data: {
          jobId: job.id,
          userId: job.userId || null,
          eventType: job.eventType,
          channel: job.channel,
          title: job.title,
          message: job.message,
          payload: job.payload || null,
          attempts,
          maxAttempts: job.maxAttempts || DEFAULT_MAX_ATTEMPTS,
          finalError: String(error?.message || error || 'Notification dispatch failed').slice(0, 1000),
          metadata: {
            failedFromStatus: job.status,
            lockedBy: job.lockedBy || null,
          },
        },
      });
    }

    return updated;
  });
};

const processNotificationJob = async ({ prisma, job }) => {
  if (job.channel !== 'in_app' && job.channel !== 'push') {
    throw new Error(`Unsupported notification channel: ${job.channel}`);
  }

  if (!job.userId) {
    throw new Error('Notification job is missing target user');
  }

  await notifyUser({
    prisma,
    userId: job.userId,
    title: job.title,
    message: job.message,
    type: (job.payload && job.payload.type) || 'system',
    relatedId: (job.payload && job.payload.relatedId) || null,
    sendPush: job.channel === 'push' || job.channel === 'in_app',
    data: job.payload || {},
  });
};

module.exports = {
  enqueueNotificationJob,
  claimPendingJobs,
  processNotificationJob,
  markJobSuccess,
  markJobFailure,
};
