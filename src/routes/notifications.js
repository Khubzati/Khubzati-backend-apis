const express = require('express');
const { PrismaClient } = require('../generated/prisma');
const { authenticateToken } = require('../middleware/auth');

const prisma = new PrismaClient();
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

module.exports = router;
