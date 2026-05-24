const express = require('express');
const prisma = require('../lib/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const {
  enqueueNotificationJob,
  claimPendingJobs,
  processNotificationJob,
  markJobSuccess,
  markJobFailure,
} = require('../services/notificationQueueService');

const router = express.Router();

// Get all notifications for the current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { is_read, page = 1, limit = 10 } = req.query;
    
    const whereClause = {
      userId: req.user.id,
      deletedAt: null
    };
    
    if (is_read !== undefined) {
      whereClause.isRead = is_read === 'true';
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [notifications, totalCount] = await Promise.all([
      prisma.notification.findMany({
        where: whereClause,
        take: parseInt(limit),
        skip,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.notification.count({ where: whereClause })
    ]);
    
    return res.status(200).json({
      status: 'success',
      data: {
        notifications,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(totalCount / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching notifications'
    });
  }
});

// Mark a notification as read
router.put('/:notificationId/read', authenticateToken, async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    // Find notification
    const notification = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId: req.user.id,
        deletedAt: null
      }
    });
    
    if (!notification) {
      return res.status(404).json({
        status: 'fail',
        message: 'Notification not found'
      });
    }
    
    // Update notification
    const updatedNotification = await prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        updatedBy: req.user.id,
        updatedAt: new Date()
      }
    });
    
    return res.status(200).json({
      status: 'success',
      data: {
        notification: updatedNotification
      }
    });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while marking notification as read'
    });
  }
});

// Mark all notifications as read
router.put('/read-all', authenticateToken, async (req, res) => {
  try {
    // Update all unread notifications
    await prisma.notification.updateMany({
      where: {
        userId: req.user.id,
        isRead: false,
        deletedAt: null
      },
      data: {
        isRead: true,
        updatedBy: req.user.id,
        updatedAt: new Date()
      }
    });
    
    return res.status(200).json({
      status: 'success',
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while marking all notifications as read'
    });
  }
});

// Enqueue notification jobs (system-safe async path)
router.post('/jobs', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];
    const jobs = [];

    for (const item of items) {
      if (!item?.eventType || !item?.title || !item?.message) {
        return res.status(400).json({
          status: 'fail',
          message: 'Each job requires eventType, title, and message',
        });
      }
      // eslint-disable-next-line no-await-in-loop
      const job = await enqueueNotificationJob({
        prisma,
        userId: item.userId || null,
        eventType: item.eventType,
        channel: item.channel || 'in_app',
        title: item.title,
        message: item.message,
        payload: item.payload || {},
        maxAttempts: Number(item.maxAttempts || 3),
      });
      jobs.push(job);
    }

    return res.status(201).json({ status: 'success', data: { jobs } });
  } catch (error) {
    console.error('Enqueue notification jobs error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to enqueue notification jobs' });
  }
});

// Pull and process pending jobs (works as a simple in-process worker endpoint).
router.post('/jobs/process', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const workerId = String(req.body?.workerId || req.user.id || 'admin-worker');
    const claimed = await claimPendingJobs({
      prisma,
      workerId,
      limit: Number(req.body?.limit || 20),
    });

    const results = [];
    for (const job of claimed) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await processNotificationJob({ prisma, job });
        // eslint-disable-next-line no-await-in-loop
        await markJobSuccess({ prisma, jobId: job.id });
        results.push({ jobId: job.id, status: 'sent' });
      } catch (error) {
        // eslint-disable-next-line no-await-in-loop
        await markJobFailure({ prisma, job, error });
        results.push({ jobId: job.id, status: 'failed', error: error.message });
      }
    }

    return res.status(200).json({
      status: 'success',
      data: {
        claimed: claimed.length,
        processed: results.length,
        results,
      },
    });
  } catch (error) {
    console.error('Process notification jobs error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to process notification jobs' });
  }
});

router.get('/jobs', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const status = req.query?.status ? String(req.query.status) : undefined;
    const jobs = await prisma.notificationJob.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return res.status(200).json({ status: 'success', data: { jobs } });
  } catch (error) {
    console.error('List notification jobs error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to list notification jobs' });
  }
});

router.get('/jobs/metrics', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const [byStatus, oldestPending, deadLetters24h] = await Promise.all([
      prisma.notificationJob.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      prisma.notificationJob.findFirst({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      prisma.notificationDeadLetter.count({
        where: {
          failedAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    const statusCounts = byStatus.reduce((acc, row) => {
      acc[row.status] = row._count.status;
      return acc;
    }, {});

    const pendingLagSeconds = oldestPending
      ? Math.max(0, Math.floor((Date.now() - new Date(oldestPending.createdAt).getTime()) / 1000))
      : 0;

    return res.status(200).json({
      status: 'success',
      data: {
        statusCounts,
        pendingLagSeconds,
        deadLetters24h,
      },
    });
  } catch (error) {
    console.error('Notification metrics error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to load notification metrics' });
  }
});

router.get('/jobs/health', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const [processingStuck, pendingCount, failedCount] = await Promise.all([
      prisma.notificationJob.count({
        where: {
          status: 'processing',
          lockedAt: {
            lt: new Date(Date.now() - 10 * 60 * 1000),
          },
        },
      }),
      prisma.notificationJob.count({ where: { status: 'pending' } }),
      prisma.notificationJob.count({ where: { status: 'failed' } }),
    ]);

    const healthy = processingStuck === 0;
    return res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      data: {
        processingStuck,
        pendingCount,
        failedCount,
      },
    });
  } catch (error) {
    console.error('Notification health error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to load notification health' });
  }
});

module.exports = router;
