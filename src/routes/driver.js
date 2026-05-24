const express = require('express');
const prisma = require('../lib/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const {
  normalizeDeliveryAssignmentStatus,
  canTransitionDeliveryAssignmentStatus,
  ORDER_STATUS_BY_DELIVERY_ASSIGNMENT_STATUS,
} = require('../utils/delivery-state-machine');
const { enqueueNotificationJob } = require('../services/notificationQueueService');

const router = express.Router();

// Ensure driver profile exists for the authenticated user
const ensureDriverProfile = async (req, res, next) => {
  try {
    let profile = await prisma.driverProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!profile) {
      profile = await prisma.driverProfile.create({
        data: {
          userId: req.user.id,
          status: 'offline',
        },
      });
    }

    req.driverProfile = profile;
    next();
  } catch (error) {
    console.error('ensureDriverProfile error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Unable to load driver profile',
    });
  }
};

// Update availability + location
router.post(
  '/availability',
  authenticateToken,
  authorizeRole(['driver']),
  ensureDriverProfile,
  async (req, res) => {
    try {
      const { status, latitude, longitude, vehicleType, licensePlate } = req.body;

      const validStatuses = ['offline', 'online', 'busy'];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ status: 'fail', message: 'Invalid status' });
      }

      const updated = await prisma.driverProfile.update({
        where: { id: req.driverProfile.id },
        data: {
          status: status || req.driverProfile.status,
          latitude,
          longitude,
          vehicleType,
          licensePlate,
        },
      });

      return res.status(200).json({ status: 'success', data: { profile: updated } });
    } catch (error) {
      console.error('availability update error:', error);
      return res.status(500).json({ status: 'error', message: 'Failed to update availability' });
    }
  },
);

// Get current driver profile/availability
router.get(
  '/availability',
  authenticateToken,
  authorizeRole(['driver']),
  ensureDriverProfile,
  async (req, res) => {
    try {
      return res.status(200).json({ status: 'success', data: { profile: req.driverProfile } });
    } catch (error) {
      console.error('get availability error:', error);
      return res.status(500).json({ status: 'error', message: 'Failed to load profile' });
    }
  },
);

// List assignments for driver
router.get(
  '/assignments',
  authenticateToken,
  authorizeRole(['driver']),
  ensureDriverProfile,
  async (req, res) => {
    try {
      const { status } = req.query;

      const assignments = await prisma.deliveryAssignment.findMany({
        where: {
          driverId: req.driverProfile.id,
          ...(status ? { status } : {}),
        },
        include: {
          order: {
            include: {
              bakery: { select: { id: true, name: true, addressLine1: true } },
              restaurant: { select: { id: true, name: true, addressLine1: true } },
              deliveryAddress: true,
              orderItems: {
                include: {
                  product: { select: { id: true, name: true, imageUrl: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.status(200).json({ status: 'success', data: { assignments } });
    } catch (error) {
      console.error('list assignments error:', error);
      return res.status(500).json({ status: 'error', message: 'Failed to load assignments' });
    }
  },
);

// List deliveries that are available for pickup (not yet actively assigned)
router.get(
  '/available-deliveries',
  authenticateToken,
  authorizeRole(['driver']),
  ensureDriverProfile,
  async (req, res) => {
    try {
      const candidateOrders = await prisma.order.findMany({
        where: {
          status: { in: ['ready_for_pickup', 'out_for_delivery'] },
          deletedAt: null,
          orderType: 'delivery',
        },
        include: {
          bakery: { select: { id: true, name: true, addressLine1: true } },
          restaurant: { select: { id: true, name: true, addressLine1: true } },
          deliveryAddress: true,
          deliveryAssignment: true,
          orderItems: {
            include: {
              product: { select: { id: true, name: true, imageUrl: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });

      const available = candidateOrders.filter((order) => {
        const assignment = order.deliveryAssignment;
        if (!assignment) return true;
        if (assignment.driverId === req.driverProfile.id) {
          return ['assigned', 'rejected'].includes(assignment.status);
        }
        return ['rejected', 'cancelled', 'failed'].includes(assignment.status);
      });

      return res.status(200).json({ status: 'success', data: { deliveries: available } });
    } catch (error) {
      console.error('list available deliveries error:', error);
      return res.status(500).json({ status: 'error', message: 'Failed to list available deliveries' });
    }
  },
);

// Accept an assignment for an order (creates or updates the assignment)
router.post(
  '/assignments/:orderId/accept',
  authenticateToken,
  authorizeRole(['driver']),
  ensureDriverProfile,
  async (req, res) => {
    try {
      const { orderId } = req.params;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { orderItems: true },
      });

      if (!order) {
        return res.status(404).json({ status: 'fail', message: 'Order not found' });
      }

      if (!['ready_for_pickup', 'out_for_delivery'].includes(order.status)) {
        return res.status(400).json({
          status: 'fail',
          message: 'Order is not ready for driver assignment',
        });
      }

      const existing = await prisma.deliveryAssignment.findFirst({
        where: { orderId },
      });

      if (existing && existing.driverId !== req.driverProfile.id) {
        return res.status(409).json({
          status: 'fail',
          message: 'Order already assigned to another driver',
        });
      }

      if (existing && existing.driverId === req.driverProfile.id) {
        const reusableStatuses = ['assigned', 'rejected'];
        if (!reusableStatuses.includes(existing.status)) {
          return res.status(409).json({
            status: 'fail',
            message: `Cannot accept assignment from status ${existing.status}`,
          });
        }
      }

      const assignment = existing
        ? await prisma.deliveryAssignment.update({
            where: { id: existing.id },
            data: {
              driverId: req.driverProfile.id,
              status: 'accepted',
              rejectedAt: null,
              failedAt: null,
              failureReason: null,
            },
          })
        : await prisma.deliveryAssignment.create({
            data: {
              orderId,
              driverId: req.driverProfile.id,
              status: 'accepted',
            },
          });

      await prisma.driverProfile.update({
        where: { id: req.driverProfile.id },
        data: {
          status: 'busy',
        },
      });

      await enqueueNotificationJob({
        prisma,
        userId: order.userId,
        eventType: 'driver_assigned',
        channel: 'in_app',
        title: 'Driver assigned',
        message: `A driver has accepted order #${order.orderNumber}.`,
        payload: { type: 'order', relatedId: order.id },
      });

      return res.status(200).json({ status: 'success', data: { assignment } });
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({
          status: 'fail',
          message: 'Order was assigned concurrently. Please refresh and try another delivery.',
        });
      }
      console.error('accept assignment error:', error);
      return res.status(500).json({ status: 'error', message: 'Unable to accept assignment' });
    }
  },
);

// Reject an available assignment
router.post(
  '/assignments/:orderId/reject',
  authenticateToken,
  authorizeRole(['driver']),
  ensureDriverProfile,
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const rejectionReason = String(req.body?.reason || '').trim() || null;

      const existing = await prisma.deliveryAssignment.findFirst({
        where: { orderId },
      });

      if (!existing) {
        const created = await prisma.deliveryAssignment.create({
          data: {
            orderId,
            driverId: req.driverProfile.id,
            status: 'rejected',
            rejectedAt: new Date(),
            failureReason: rejectionReason,
          },
        });
        return res.status(200).json({ status: 'success', data: { assignment: created } });
      }

      if (existing.driverId !== req.driverProfile.id) {
        return res.status(409).json({
          status: 'fail',
          message: 'Order assignment belongs to another driver',
        });
      }

      if (!canTransitionDeliveryAssignmentStatus(existing.status, 'rejected')) {
        return res.status(409).json({
          status: 'fail',
          message: `Cannot reject assignment from status ${existing.status}`,
        });
      }

      const updated = await prisma.deliveryAssignment.update({
        where: { id: existing.id },
        data: {
          status: 'rejected',
          rejectedAt: new Date(),
          failureReason: rejectionReason,
        },
      });

      await prisma.driverProfile.update({
        where: { id: req.driverProfile.id },
        data: { status: 'online' },
      });

      return res.status(200).json({ status: 'success', data: { assignment: updated } });
    } catch (error) {
      console.error('reject assignment error:', error);
      return res.status(500).json({ status: 'error', message: 'Unable to reject assignment' });
    }
  },
);

// Update assignment status (picked_up / delivered / cancelled)
router.post(
  '/assignments/:orderId/status',
  authenticateToken,
  authorizeRole(['driver']),
  ensureDriverProfile,
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const normalizedStatus = normalizeDeliveryAssignmentStatus(req.body?.status);
      const valid = ['picked_up', 'out_for_delivery', 'delivered', 'cancelled', 'failed'];
      if (!valid.includes(normalizedStatus)) {
        return res.status(400).json({ status: 'fail', message: 'Invalid status' });
      }

      const assignment = await prisma.deliveryAssignment.findFirst({
        where: { orderId, driverId: req.driverProfile.id },
      });

      if (!assignment) {
        return res.status(404).json({ status: 'fail', message: 'Assignment not found' });
      }

      if (!canTransitionDeliveryAssignmentStatus(assignment.status, normalizedStatus)) {
        return res.status(409).json({
          status: 'fail',
          message: `Cannot transition delivery assignment from ${assignment.status} to ${normalizedStatus}`,
        });
      }

      const updateData = {
        status: normalizedStatus,
        deliveryNote: req.body?.deliveryNote || assignment.deliveryNote,
      };
      if (normalizedStatus === 'picked_up') updateData.pickedUpAt = new Date();
      if (normalizedStatus === 'delivered') updateData.deliveredAt = new Date();
      if (normalizedStatus === 'failed') {
        updateData.failedAt = new Date();
        updateData.failureReason =
          String(req.body?.failureReason || '').trim() || 'delivery_failed';
      }
      if (normalizedStatus === 'delivered') {
        const proofImageUrl = String(req.body?.proofImageUrl || '').trim() || null;
        if (proofImageUrl) {
          updateData.proofImageUrl = proofImageUrl;
        }
      }

      await prisma.$transaction([
        prisma.deliveryAssignment.update({
          where: { id: assignment.id },
          data: updateData,
        }),
        prisma.order.update({
          where: { id: orderId },
          data: {
            status:
              ORDER_STATUS_BY_DELIVERY_ASSIGNMENT_STATUS[normalizedStatus] || 'out_for_delivery',
            updatedAt: new Date(),
            updatedBy: req.user.id,
          },
        }),
        prisma.driverProfile.update({
          where: { id: req.driverProfile.id },
          data: ['delivered', 'cancelled', 'failed'].includes(normalizedStatus)
            ? { status: 'online' }
            : { status: 'busy' },
        }),
      ]);

      return res.status(200).json({ status: 'success' });
    } catch (error) {
      console.error('update driver status error:', error);
      return res.status(500).json({ status: 'error', message: 'Unable to update status' });
    }
  },
);

module.exports = router;
