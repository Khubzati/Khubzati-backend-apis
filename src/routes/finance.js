const express = require('express');
const prisma = require('../lib/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { StripePaymentProvider } = require('../services/payments/stripe-payment-provider');
const {
  toMoney,
  ensureOrderFinancialRecord,
  appendFinancialTransaction,
  resolveVendorContext,
  getVendorAvailableBalance,
} = require('../services/financeService');
const { enqueueNotificationJob } = require('../services/notificationQueueService');
const { logAuditEvent } = require('../services/auditLogService');

const router = express.Router();
const stripeProvider = new StripePaymentProvider();

const isAdmin = (req) => req.user?.role === 'admin';
const isVendorOwnerRole = (role) => role === 'bakery_owner' || role === 'restaurant_owner';

const canAccessOrder = (req, order) => {
  if (!order) return false;
  if (isAdmin(req)) return true;
  if (req.user.id === order.userId) return true;
  if (req.user.role === 'bakery_owner' && order.bakery?.ownerId === req.user.id) return true;
  if (req.user.role === 'restaurant_owner' && order.restaurant?.ownerId === req.user.id) return true;
  if (req.user.role === 'driver' && order.deliveryAssignment?.driver?.userId === req.user.id) return true;
  return false;
};

const getOrderWithActors = (orderId) =>
  prisma.order.findUnique({
    where: { id: orderId },
    include: {
      bakery: { select: { id: true, ownerId: true, name: true } },
      restaurant: { select: { id: true, ownerId: true, name: true } },
      user: { select: { id: true, fullName: true } },
      deliveryAssignment: { include: { driver: true } },
    },
  });

const resolveVendorOwnership = (order, userId) => {
  if (!order) return null;
  if (order.bakery && order.bakery.ownerId === userId) {
    return { vendorType: 'bakery', vendorId: order.bakery.id };
  }
  if (order.restaurant && order.restaurant.ownerId === userId) {
    return { vendorType: 'restaurant', vendorId: order.restaurant.id };
  }
  return null;
};

const appendVendorLedgerEntry = async ({
  prisma,
  vendorType,
  vendorId,
  orderId = null,
  payoutRequestId = null,
  settlementBatchId = null,
  entryType,
  amount,
  currency = 'JOD',
  description = null,
  metadata = null,
}) => {
  try {
    return await prisma.vendorLedgerEntry.create({
      data: {
        vendorType,
        vendorId,
        orderId,
        payoutRequestId,
        settlementBatchId,
        entryType,
        amount: toMoney(amount),
        currency,
        description,
        metadata: metadata || null,
      },
    });
  } catch (error) {
    const isMissingTableError =
      (error?.code === 'P2021' || error?.code === 'P2022') &&
      (
        error?.meta?.modelName === 'VendorLedgerEntry' ||
        String(error?.meta?.table || '').includes('vendor_ledger_entries')
      );
    if (isMissingTableError) {
      return null;
    }
    throw error;
  }
};

// ---------- Commission ----------

router.get('/commission-config', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const configs = await prisma.commissionConfig.findMany({
      where: { isActive: true },
      orderBy: [{ scope: 'asc' }, { createdAt: 'desc' }],
    });
    const globalConfig = configs.find((item) => item.scope === 'global') || null;
    const vendorConfigs = configs.filter((item) => item.scope === 'vendor');

    return res.status(200).json({
      status: 'success',
      data: {
        configs,
        globalConfig,
        vendorConfigs,
      },
    });
  } catch (error) {
    console.error('Get commission config error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to load commission config' });
  }
});

router.put('/commission-config/global', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const rateBps = Number(req.body?.rateBps);
    if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) {
      return res.status(400).json({ status: 'fail', message: 'rateBps must be an integer between 0 and 10000' });
    }

    await prisma.commissionConfig.updateMany({
      where: { scope: 'global', isActive: true },
      data: { isActive: false, updatedBy: req.user.id },
    });

    const config = await prisma.commissionConfig.create({
      data: {
        scope: 'global',
        rateBps,
        isActive: true,
        notes: String(req.body?.notes || '').trim() || null,
        createdBy: req.user.id,
        updatedBy: req.user.id,
      },
    });

    await logAuditEvent({
      prisma,
      req,
      action: 'finance.commission.global.updated',
      entityType: 'commission_config',
      entityId: config.id,
      metadata: { rateBps },
    });

    return res.status(200).json({ status: 'success', data: { config } });
  } catch (error) {
    console.error('Set global commission error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to update global commission' });
  }
});

router.put('/commission-config/vendors/:vendorType/:vendorId', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const { vendorType, vendorId } = req.params;
    if (!['bakery', 'restaurant'].includes(vendorType)) {
      return res.status(400).json({ status: 'fail', message: 'vendorType must be bakery or restaurant' });
    }

    const rateBps = Number(req.body?.rateBps);
    if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) {
      return res.status(400).json({ status: 'fail', message: 'rateBps must be an integer between 0 and 10000' });
    }

    await prisma.commissionConfig.updateMany({
      where: { scope: 'vendor', vendorType, vendorId, isActive: true },
      data: { isActive: false, updatedBy: req.user.id },
    });

    const config = await prisma.commissionConfig.create({
      data: {
        scope: 'vendor',
        vendorType,
        vendorId,
        rateBps,
        isActive: true,
        notes: String(req.body?.notes || '').trim() || null,
        createdBy: req.user.id,
        updatedBy: req.user.id,
      },
    });

    await logAuditEvent({
      prisma,
      req,
      action: 'finance.commission.vendor.updated',
      entityType: 'commission_config',
      entityId: config.id,
      metadata: { vendorType, vendorId, rateBps },
    });

    return res.status(200).json({ status: 'success', data: { config } });
  } catch (error) {
    console.error('Set vendor commission error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to update vendor commission' });
  }
});

router.post('/orders/:orderId/snapshot', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const record = await ensureOrderFinancialRecord({ prisma, orderId: req.params.orderId });
    return res.status(200).json({ status: 'success', data: { record } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: 'error',
      message: error.message || 'Unable to snapshot order finance',
    });
  }
});

// ---------- Refunds ----------

router.post('/refunds', authenticateToken, async (req, res) => {
  try {
    const { orderId, amount, reason } = req.body;
    if (!orderId || !reason) {
      return res.status(400).json({ status: 'fail', message: 'orderId and reason are required' });
    }

    const order = await getOrderWithActors(orderId);
    if (!order || !canAccessOrder(req, order)) {
      return res.status(403).json({ status: 'fail', message: 'You do not have permission to request this refund' });
    }

    const numericAmount = toMoney(amount || order.totalAmount);
    if (numericAmount <= 0 || numericAmount > toMoney(order.totalAmount)) {
      return res.status(400).json({ status: 'fail', message: 'Invalid refund amount' });
    }

    const existingRefunds = await prisma.refundRequest.aggregate({
      _sum: { amount: true },
      where: {
        orderId: order.id,
        status: { in: ['pending', 'approved', 'processing', 'completed'] },
      },
    });
    const alreadyRequestedAmount = toMoney(existingRefunds._sum.amount || 0);
    if (toMoney(alreadyRequestedAmount + numericAmount) > toMoney(order.totalAmount)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Refund amount exceeds the remaining refundable order balance',
      });
    }

    const refund = await prisma.refundRequest.create({
      data: {
        orderId: order.id,
        requesterUserId: req.user.id,
        requesterRole: req.user.role,
        amount: numericAmount,
        reason: String(reason).trim(),
        status: isAdmin(req) ? 'approved' : 'pending',
        approvedByUserId: isAdmin(req) ? req.user.id : null,
        approvedAt: isAdmin(req) ? new Date() : null,
      },
    });

    await appendFinancialTransaction({
      prisma,
      orderId: order.id,
      refundRequestId: refund.id,
      transactionType: 'refund',
      status: refund.status,
      amount: numericAmount,
      currency: order.currency || 'JOD',
      metadata: { reason: refund.reason },
    });

    await logAuditEvent({
      prisma,
      req,
      action: 'finance.refund.requested',
      entityType: 'refund_request',
      entityId: refund.id,
      metadata: { orderId: order.id, amount: numericAmount, status: refund.status },
    });

    if (!isAdmin(req)) {
      const adminUsers = await prisma.user.findMany({
        where: { role: 'admin', deletedAt: null },
        select: { id: true },
      });
      await Promise.all(
        adminUsers.map((adminUser) =>
          enqueueNotificationJob({
            prisma,
            userId: adminUser.id,
            eventType: 'refund_requested',
            channel: 'in_app',
            title: 'Refund requested',
            message: `Refund request for order #${order.orderNumber}`,
            payload: { type: 'order', relatedId: order.id, refundRequestId: refund.id },
          }),
        ),
      );
    }

    return res.status(201).json({ status: 'success', data: { refund } });
  } catch (error) {
    console.error('Create refund request error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to create refund request' });
  }
});

router.get('/refunds', authenticateToken, async (req, res) => {
  try {
    const where = {};
    if (!isAdmin(req)) {
      if (req.user.role === 'customer') {
        where.requesterUserId = req.user.id;
      } else if (isVendorOwnerRole(req.user.role)) {
        where.order = req.user.role === 'bakery_owner'
          ? { is: { bakery: { is: { ownerId: req.user.id } } } }
          : { is: { restaurant: { is: { ownerId: req.user.id } } } };
      } else {
        where.requesterUserId = req.user.id;
      }
    }

    const refunds = await prisma.refundRequest.findMany({
      where,
      include: {
        order: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return res.status(200).json({ status: 'success', data: { refunds } });
  } catch (error) {
    console.error('List refunds error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to list refunds' });
  }
});

router.post('/refunds/:refundId/approve', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const refund = await prisma.refundRequest.findUnique({
      where: { id: req.params.refundId },
      include: { order: true },
    });

    if (!refund) return res.status(404).json({ status: 'fail', message: 'Refund request not found' });
    if (refund.status !== 'pending') {
      return res.status(409).json({ status: 'fail', message: 'Refund request is not pending' });
    }

    const updated = await prisma.refundRequest.update({
      where: { id: refund.id },
      data: {
        status: 'approved',
        approvedByUserId: req.user.id,
        approvedAt: new Date(),
        adminNotes: String(req.body?.adminNotes || '').trim() || null,
      },
    });

    await appendFinancialTransaction({
      prisma,
      orderId: refund.orderId,
      refundRequestId: refund.id,
      transactionType: 'refund',
      status: 'approved',
      amount: refund.amount,
      currency: refund.order.currency || 'JOD',
      metadata: { approvedBy: req.user.id },
    });

    await enqueueNotificationJob({
      prisma,
      userId: refund.requesterUserId,
      eventType: 'refund_approved',
      channel: 'in_app',
      title: 'Refund approved',
      message: `Your refund request for order #${refund.order.orderNumber} was approved.`,
      payload: { type: 'order', relatedId: refund.orderId, refundRequestId: refund.id },
    });

    await logAuditEvent({
      prisma,
      req,
      action: 'finance.refund.approved',
      entityType: 'refund_request',
      entityId: refund.id,
      metadata: { orderId: refund.orderId },
    });

    return res.status(200).json({ status: 'success', data: { refund: updated } });
  } catch (error) {
    console.error('Approve refund error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to approve refund' });
  }
});

router.post('/refunds/:refundId/reject', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const refund = await prisma.refundRequest.findUnique({ where: { id: req.params.refundId } });
    if (!refund) return res.status(404).json({ status: 'fail', message: 'Refund request not found' });
    if (refund.status !== 'pending') {
      return res.status(409).json({ status: 'fail', message: 'Refund request is not pending' });
    }

    const updated = await prisma.refundRequest.update({
      where: { id: refund.id },
      data: {
        status: 'rejected',
        adminNotes: String(req.body?.adminNotes || '').trim() || null,
        approvedByUserId: req.user.id,
        approvedAt: new Date(),
      },
    });

    await logAuditEvent({
      prisma,
      req,
      action: 'finance.refund.rejected',
      entityType: 'refund_request',
      entityId: refund.id,
    });

    return res.status(200).json({ status: 'success', data: { refund: updated } });
  } catch (error) {
    console.error('Reject refund error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to reject refund' });
  }
});

router.post('/refunds/:refundId/process', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const refund = await prisma.refundRequest.findUnique({
      where: { id: req.params.refundId },
      include: { order: true },
    });

    if (!refund) return res.status(404).json({ status: 'fail', message: 'Refund request not found' });
    if (!['approved', 'processing'].includes(refund.status)) {
      return res.status(409).json({ status: 'fail', message: 'Refund request must be approved first' });
    }

    let providerRefundId = null;
    let providerStatus = 'completed';
    let providerName = 'manual';

    if (refund.order.paymentProvider === 'stripe' && refund.order.providerPaymentId) {
      const stripeRefund = await stripeProvider.createRefund({
        paymentIntentId: refund.order.providerPaymentId,
        amount: Number(refund.amount),
        metadata: { orderId: refund.orderId, refundRequestId: refund.id },
      });

      providerRefundId = stripeRefund.id;
      providerStatus = stripeRefund.status === 'succeeded' ? 'completed' : 'processing';
      providerName = 'stripe';
    }

    const updated = await prisma.refundRequest.update({
      where: { id: refund.id },
      data: {
        status: providerStatus,
        providerRefundId,
        processedAt: providerStatus === 'completed' ? new Date() : null,
      },
    });

    await ensureOrderFinancialRecord({ prisma, orderId: refund.orderId });
    await prisma.orderFinancialRecord.update({
      where: { orderId: refund.orderId },
      data: {
        refundedAmount: { increment: refund.amount },
        netPlatformAmount: { decrement: refund.amount },
      },
    });

    await appendFinancialTransaction({
      prisma,
      orderId: refund.orderId,
      refundRequestId: refund.id,
      transactionType: 'refund',
      status: updated.status,
      amount: refund.amount,
      currency: refund.order.currency || 'JOD',
      provider: providerName,
      providerReference: providerRefundId,
      metadata: { processedBy: req.user.id },
    });

    await enqueueNotificationJob({
      prisma,
      userId: refund.requesterUserId,
      eventType: 'refund_processed',
      channel: 'in_app',
      title: 'Refund update',
      message: updated.status === 'completed' ? 'Your refund was completed.' : 'Your refund is being processed.',
      payload: { type: 'order', relatedId: refund.orderId, refundRequestId: refund.id },
    });

    await logAuditEvent({
      prisma,
      req,
      action: 'finance.refund.processed',
      entityType: 'refund_request',
      entityId: refund.id,
      metadata: { provider: providerName, providerRefundId },
    });

    return res.status(200).json({ status: 'success', data: { refund: updated } });
  } catch (error) {
    console.error('Process refund error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to process refund' });
  }
});

// ---------- Disputes ----------

router.post('/disputes', authenticateToken, authorizeRole(['customer']), async (req, res) => {
  try {
    const { orderId, subject, description, evidenceUrl } = req.body;
    if (!orderId || !subject || !description) {
      return res.status(400).json({ status: 'fail', message: 'orderId, subject and description are required' });
    }

    const order = await getOrderWithActors(orderId);
    if (!order || order.userId !== req.user.id) {
      return res.status(403).json({ status: 'fail', message: 'You can only dispute your own orders' });
    }

    const { vendorType, vendorId } = resolveVendorContext(order);
    if (!vendorType || !vendorId) {
      return res.status(400).json({ status: 'fail', message: 'Order vendor context is incomplete' });
    }

    const dispute = await prisma.disputeCase.create({
      data: {
        orderId: order.id,
        customerId: req.user.id,
        vendorType,
        vendorId,
        subject: String(subject).trim(),
        description: String(description).trim(),
        evidenceUrl: String(evidenceUrl || '').trim() || null,
      },
    });

    const vendorOwnerId = order.bakery?.ownerId || order.restaurant?.ownerId || null;
    if (vendorOwnerId) {
      await enqueueNotificationJob({
        prisma,
        userId: vendorOwnerId,
        eventType: 'dispute_created',
        channel: 'in_app',
        title: 'New dispute opened',
        message: `A customer opened a dispute for order #${order.orderNumber}.`,
        payload: { type: 'order', relatedId: order.id, disputeId: dispute.id },
      });
    }

    await logAuditEvent({
      prisma,
      req,
      action: 'finance.dispute.created',
      entityType: 'dispute_case',
      entityId: dispute.id,
      metadata: { orderId: order.id },
    });

    return res.status(201).json({ status: 'success', data: { dispute } });
  } catch (error) {
    console.error('Create dispute error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to create dispute' });
  }
});

router.get('/disputes', authenticateToken, async (req, res) => {
  try {
    const where = {};
    if (!isAdmin(req)) {
      if (req.user.role === 'customer') {
        where.customerId = req.user.id;
      } else if (req.user.role === 'bakery_owner') {
        where.vendorType = 'bakery';
        const bakery = await prisma.bakery.findFirst({
          where: { ownerId: req.user.id, deletedAt: null },
          select: { id: true },
        });
        where.vendorId = bakery?.id || '__none__';
      } else if (req.user.role === 'restaurant_owner') {
        where.vendorType = 'restaurant';
        const restaurant = await prisma.restaurant.findFirst({
          where: { ownerId: req.user.id, deletedAt: null },
          select: { id: true },
        });
        where.vendorId = restaurant?.id || '__none__';
      } else {
        where.customerId = req.user.id;
      }
    }

    const disputes = await prisma.disputeCase.findMany({
      where,
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return res.status(200).json({ status: 'success', data: { disputes } });
  } catch (error) {
    console.error('List disputes error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to list disputes' });
  }
});

router.post('/disputes/:disputeId/messages', authenticateToken, async (req, res) => {
  try {
    const dispute = await prisma.disputeCase.findUnique({
      where: { id: req.params.disputeId },
      include: {
        order: {
          include: {
            bakery: true,
            restaurant: true,
          },
        },
      },
    });
    if (!dispute) return res.status(404).json({ status: 'fail', message: 'Dispute not found' });

    const vendorOwnerId = dispute.order.bakery?.ownerId || dispute.order.restaurant?.ownerId || null;
    const canParticipate =
      isAdmin(req) || req.user.id === dispute.customerId || req.user.id === vendorOwnerId;

    if (!canParticipate) {
      return res.status(403).json({ status: 'fail', message: 'You do not have permission to respond to this dispute' });
    }

    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ status: 'fail', message: 'message is required' });
    }

    const created = await prisma.disputeMessage.create({
      data: {
        disputeId: dispute.id,
        senderUserId: req.user.id,
        senderRole: req.user.role,
        message,
        attachmentUrl: String(req.body?.attachmentUrl || '').trim() || null,
      },
    });

    const nextStatus = isAdmin(req) ? 'under_review' : req.user.id === vendorOwnerId ? 'vendor_responded' : dispute.status;
    if (nextStatus !== dispute.status) {
      await prisma.disputeCase.update({
        where: { id: dispute.id },
        data: { status: nextStatus },
      });
    }

    return res.status(201).json({ status: 'success', data: { message: created } });
  } catch (error) {
    console.error('Add dispute message error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to add dispute message' });
  }
});

router.post('/disputes/:disputeId/resolve', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const rawStatus =
      req.body?.status ||
      (req.body?.resolution === 'approved' ? 'resolved' : req.body?.resolution);
    const status = String(rawStatus || '').trim().toLowerCase();
    if (!['resolved', 'rejected'].includes(status)) {
      return res.status(400).json({ status: 'fail', message: 'status must be resolved or rejected' });
    }

    const dispute = await prisma.disputeCase.findUnique({ where: { id: req.params.disputeId } });
    if (!dispute) return res.status(404).json({ status: 'fail', message: 'Dispute not found' });

    const updated = await prisma.disputeCase.update({
      where: { id: dispute.id },
      data: {
        status,
        resolutionNote: String(req.body?.resolutionNote || '').trim() || null,
        resolvedByUserId: req.user.id,
        resolvedAt: new Date(),
      },
    });

    await enqueueNotificationJob({
      prisma,
      userId: dispute.customerId,
      eventType: 'dispute_updated',
      channel: 'in_app',
      title: 'Dispute updated',
      message: `Your dispute was ${status}.`,
      payload: { type: 'order', relatedId: dispute.orderId, disputeId: dispute.id },
    });

    await logAuditEvent({
      prisma,
      req,
      action: 'finance.dispute.resolved',
      entityType: 'dispute_case',
      entityId: dispute.id,
      metadata: { status },
    });

    return res.status(200).json({ status: 'success', data: { dispute: updated } });
  } catch (error) {
    console.error('Resolve dispute error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to resolve dispute' });
  }
});

// ---------- Payouts ----------

router.post('/payouts/request', authenticateToken, authorizeRole(['bakery_owner', 'restaurant_owner']), async (req, res) => {
  try {
    const amount = toMoney(req.body?.amount);
    if (amount <= 0) return res.status(400).json({ status: 'fail', message: 'amount must be greater than zero' });

    const vendorType = req.user.role === 'bakery_owner' ? 'bakery' : 'restaurant';
    const vendor = vendorType === 'bakery'
      ? await prisma.bakery.findFirst({ where: { ownerId: req.user.id, deletedAt: null } })
      : await prisma.restaurant.findFirst({ where: { ownerId: req.user.id, deletedAt: null } });

    if (!vendor) {
      return res.status(404).json({ status: 'fail', message: `${vendorType} profile not found` });
    }

    const availableBalance = await getVendorAvailableBalance({
      prisma,
      vendorType,
      vendorId: vendor.id,
    });

    if (amount > availableBalance) {
      return res.status(400).json({
        status: 'fail',
        message: `Requested payout exceeds available balance (${availableBalance})`,
      });
    }

    const payout = await prisma.payoutRequest.create({
      data: {
        vendorType,
        vendorId: vendor.id,
        requesterUserId: req.user.id,
        amount,
        currency: String(req.body?.currency || vendor.currency || 'JOD').toUpperCase(),
        reason: String(req.body?.reason || '').trim() || null,
      },
    });

    await appendFinancialTransaction({
      prisma,
      payoutRequestId: payout.id,
      transactionType: 'payout',
      status: payout.status,
      amount,
      currency: payout.currency,
      metadata: { vendorType, vendorId: vendor.id },
    });

    await appendVendorLedgerEntry({
      prisma,
      vendorType,
      vendorId: vendor.id,
      payoutRequestId: payout.id,
      entryType: 'payout_requested',
      amount: -Math.abs(amount),
      currency: payout.currency,
      description: 'Payout requested by vendor',
      metadata: {
        requesterUserId: req.user.id,
      },
    });

    await logAuditEvent({
      prisma,
      req,
      action: 'finance.payout.requested',
      entityType: 'payout_request',
      entityId: payout.id,
      metadata: { amount, vendorType, vendorId: vendor.id },
    });

    return res.status(201).json({ status: 'success', data: { payout } });
  } catch (error) {
    console.error('Create payout request error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to request payout' });
  }
});

router.get('/payouts', authenticateToken, async (req, res) => {
  try {
    const where = {};
    if (!isAdmin(req)) {
      if (!isVendorOwnerRole(req.user.role)) {
        return res.status(403).json({ status: 'fail', message: 'Only admins and vendors can view payouts' });
      }
      const vendorType = req.user.role === 'bakery_owner' ? 'bakery' : 'restaurant';
      const vendor = vendorType === 'bakery'
        ? await prisma.bakery.findFirst({ where: { ownerId: req.user.id, deletedAt: null } })
        : await prisma.restaurant.findFirst({ where: { ownerId: req.user.id, deletedAt: null } });
      if (!vendor) return res.status(200).json({ status: 'success', data: { payouts: [] } });
      where.vendorType = vendorType;
      where.vendorId = vendor.id;
    }

    const payouts = await prisma.payoutRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return res.status(200).json({ status: 'success', data: { payouts } });
  } catch (error) {
    console.error('List payouts error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to list payouts' });
  }
});

const updatePayoutStatus = (targetStatus) =>
  async (req, res) => {
    try {
      const payout = await prisma.payoutRequest.findUnique({ where: { id: req.params.payoutId } });
      if (!payout) return res.status(404).json({ status: 'fail', message: 'Payout request not found' });

      const data = {
        status: targetStatus,
        reviewedByUserId: req.user.id,
        reviewedAt: new Date(),
      };
      if (targetStatus === 'paid') {
        data.paidAt = new Date();
        data.transactionRef = String(req.body?.transactionRef || '').trim() || payout.transactionRef;
      }
      if (targetStatus === 'rejected') {
        data.reason = String(req.body?.reason || payout.reason || 'Rejected by admin').trim();
      }

      const updated = await prisma.payoutRequest.update({
        where: { id: payout.id },
        data,
      });

      await appendFinancialTransaction({
        prisma,
        payoutRequestId: payout.id,
        transactionType: 'payout',
        status: targetStatus,
        amount: payout.amount,
        currency: payout.currency,
        metadata: { reviewedBy: req.user.id },
      });

      await appendVendorLedgerEntry({
        prisma,
        vendorType: payout.vendorType,
        vendorId: payout.vendorId,
        payoutRequestId: payout.id,
        entryType: `payout_${targetStatus}`,
        amount: targetStatus === 'rejected' ? Math.abs(Number(payout.amount)) : -Math.abs(Number(payout.amount)),
        currency: payout.currency,
        description: `Payout ${targetStatus}`,
        metadata: { reviewedBy: req.user.id },
      });

      await logAuditEvent({
        prisma,
        req,
        action: `finance.payout.${targetStatus}`,
        entityType: 'payout_request',
        entityId: payout.id,
      });

      return res.status(200).json({ status: 'success', data: { payout: updated } });
    } catch (error) {
      console.error(`Update payout status (${targetStatus}) error:`, error);
      return res.status(500).json({ status: 'error', message: 'Unable to update payout status' });
    }
  };

router.post('/payouts/:payoutId/approve', authenticateToken, authorizeRole(['admin']), updatePayoutStatus('approved'));
router.post('/payouts/:payoutId/reject', authenticateToken, authorizeRole(['admin']), updatePayoutStatus('rejected'));
router.post('/payouts/:payoutId/mark-paid', authenticateToken, authorizeRole(['admin']), updatePayoutStatus('paid'));

router.post('/payouts/bulk-actions', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const payoutIds = Array.isArray(req.body?.payoutIds) ? req.body.payoutIds.map((id) => String(id)) : [];
    const action = String(req.body?.action || '').trim().toLowerCase();
    if (!payoutIds.length || !['approve', 'reject', 'mark_paid'].includes(action)) {
      return res.status(400).json({
        status: 'fail',
        message: 'payoutIds and action (approve|reject|mark_paid) are required',
      });
    }

    const statusMap = {
      approve: 'approved',
      reject: 'rejected',
      mark_paid: 'paid',
    };
    const targetStatus = statusMap[action];
    const updated = await prisma.payoutRequest.updateMany({
      where: { id: { in: payoutIds } },
      data: {
        status: targetStatus,
        reviewedByUserId: req.user.id,
        reviewedAt: new Date(),
        ...(targetStatus === 'paid' ? { paidAt: new Date() } : {}),
      },
    });

    await logAuditEvent({
      prisma,
      req,
      action: 'finance.payout.bulk_action',
      entityType: 'payout_request',
      metadata: {
        payoutIds,
        targetStatus,
        updatedCount: updated.count,
      },
    });

    return res.status(200).json({
      status: 'success',
      data: {
        updatedCount: updated.count,
        targetStatus,
      },
    });
  } catch (error) {
    console.error('Bulk payout action error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to run bulk payout action' });
  }
});

router.get('/payout-accounts', authenticateToken, async (req, res) => {
  try {
    const where = {};
    if (!isAdmin(req)) {
      if (!isVendorOwnerRole(req.user.role)) {
        return res.status(403).json({ status: 'fail', message: 'Only admins and vendors can view payout accounts' });
      }
      const vendorType = req.user.role === 'bakery_owner' ? 'bakery' : 'restaurant';
      const vendor = vendorType === 'bakery'
        ? await prisma.bakery.findFirst({ where: { ownerId: req.user.id, deletedAt: null }, select: { id: true } })
        : await prisma.restaurant.findFirst({ where: { ownerId: req.user.id, deletedAt: null }, select: { id: true } });
      where.vendorType = vendorType;
      where.vendorId = vendor?.id || '__none__';
    }

    const accounts = await prisma.payoutAccount.findMany({
      where,
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return res.status(200).json({ status: 'success', data: { accounts } });
  } catch (error) {
    console.error('List payout accounts error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to list payout accounts' });
  }
});

router.post('/payout-accounts', authenticateToken, async (req, res) => {
  try {
    let vendorType = String(req.body?.vendorType || '').trim().toLowerCase();
    let vendorId = String(req.body?.vendorId || '').trim();

    if (!isAdmin(req)) {
      if (!isVendorOwnerRole(req.user.role)) {
        return res.status(403).json({ status: 'fail', message: 'Only admins and vendors can manage payout accounts' });
      }
      vendorType = req.user.role === 'bakery_owner' ? 'bakery' : 'restaurant';
      const vendor = vendorType === 'bakery'
        ? await prisma.bakery.findFirst({ where: { ownerId: req.user.id, deletedAt: null }, select: { id: true } })
        : await prisma.restaurant.findFirst({ where: { ownerId: req.user.id, deletedAt: null }, select: { id: true } });
      vendorId = vendor?.id || '';
    }

    if (!['bakery', 'restaurant'].includes(vendorType) || !vendorId) {
      return res.status(400).json({ status: 'fail', message: 'Valid vendorType and vendorId are required' });
    }

    const isPrimary = req.body?.isPrimary !== false;
    const account = await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.payoutAccount.updateMany({
          where: {
            vendorType,
            vendorId,
            isPrimary: true,
          },
          data: {
            isPrimary: false,
          },
        });
      }

      return tx.payoutAccount.create({
        data: {
          vendorType,
          vendorId,
          accountHolderName: String(req.body?.accountHolderName || '').trim() || null,
          bankName: String(req.body?.bankName || '').trim() || null,
          iban: String(req.body?.iban || '').trim() || null,
          accountNumberLast4: String(req.body?.accountNumberLast4 || '').trim() || null,
          provider: String(req.body?.provider || '').trim() || null,
          externalAccountId: String(req.body?.externalAccountId || '').trim() || null,
          isPrimary,
          isVerified: Boolean(req.body?.isVerified),
          metadata: req.body?.metadata || null,
        },
      });
    });

    await logAuditEvent({
      prisma,
      req,
      action: 'finance.payout_account.created',
      entityType: 'payout_account',
      entityId: account.id,
      metadata: { vendorType, vendorId, isPrimary },
    });

    return res.status(201).json({ status: 'success', data: { account } });
  } catch (error) {
    console.error('Create payout account error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to create payout account' });
  }
});

router.get('/vendor-ledger', authenticateToken, async (req, res) => {
  try {
    const vendorType = String(req.query?.vendorType || '').trim().toLowerCase();
    const vendorId = String(req.query?.vendorId || '').trim();

    if (!isAdmin(req)) {
      if (!isVendorOwnerRole(req.user.role)) {
        return res.status(403).json({ status: 'fail', message: 'Only admins and vendors can view vendor ledger' });
      }
    }

    const where = {};
    if (vendorType) where.vendorType = vendorType;
    if (vendorId) where.vendorId = vendorId;

    const entries = await prisma.vendorLedgerEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(req.query?.limit || 500), 1000),
    });

    return res.status(200).json({ status: 'success', data: { entries } });
  } catch (error) {
    console.error('Vendor ledger list error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to list vendor ledger entries' });
  }
});

router.post('/settlement-batches', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const periodStart = new Date(String(req.body?.periodStart || ''));
    const periodEnd = new Date(String(req.body?.periodEnd || ''));
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodEnd <= periodStart) {
      return res.status(400).json({
        status: 'fail',
        message: 'Valid periodStart and periodEnd are required',
      });
    }

    const batchNumber = `SET-${Date.now()}`;
    const batch = await prisma.settlementBatch.create({
      data: {
        batchNumber,
        status: 'draft',
        periodStart,
        periodEnd,
        totalVendors: Number(req.body?.totalVendors || 0),
        totalAmount: toMoney(req.body?.totalAmount || 0),
        currency: String(req.body?.currency || 'JOD').toUpperCase(),
        createdByUserId: req.user.id,
        metadata: req.body?.metadata || null,
      },
    });

    await logAuditEvent({
      prisma,
      req,
      action: 'finance.settlement_batch.created',
      entityType: 'settlement_batch',
      entityId: batch.id,
      metadata: { batchNumber },
    });

    return res.status(201).json({ status: 'success', data: { batch } });
  } catch (error) {
    console.error('Create settlement batch error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to create settlement batch' });
  }
});

router.get('/settlement-batches', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const batches = await prisma.settlementBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(req.query?.limit || 200), 500),
    });
    return res.status(200).json({ status: 'success', data: { batches } });
  } catch (error) {
    console.error('List settlement batches error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to list settlement batches' });
  }
});

// ---------- Reconciliation / analytics ----------

router.get('/transactions', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const transactions = await prisma.financialTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return res.status(200).json({ status: 'success', data: { transactions } });
  } catch (error) {
    console.error('List transactions error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to list transactions' });
  }
});

router.get('/audit-logs', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return res.status(200).json({ status: 'success', data: { logs } });
  } catch (error) {
    console.error('List audit logs error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to list audit logs' });
  }
});

router.get('/reconciliation', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const records = await prisma.orderFinancialRecord.findMany({
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            paymentStatus: true,
          },
        },
      },
      take: 1000,
    });

    const mismatches = records.filter((record) => {
      const gross = toMoney(record.grossAmount);
      const expected = toMoney(
        toMoney(record.vendorNetAmount) +
          toMoney(record.commissionAmount) +
          toMoney(record.refundedAmount),
      );
      return Math.abs(gross - expected) > 0.01;
    });

    const totals = records.reduce(
      (acc, record) => {
        acc.gross += toMoney(record.grossAmount);
        acc.commission += toMoney(record.commissionAmount);
        acc.refunded += toMoney(record.refundedAmount);
        acc.payout += toMoney(record.payoutAmount);
        return acc;
      },
      { gross: 0, commission: 0, refunded: 0, payout: 0 },
    );

    return res.status(200).json({
      status: 'success',
      data: {
        totals,
        mismatchCount: mismatches.length,
        mismatches,
      },
    });
  } catch (error) {
    console.error('Reconciliation report error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to generate reconciliation report' });
  }
});

router.get('/reconciliation/export', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const refunds = await prisma.refundRequest.findMany({
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            currency: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(req.query?.limit || 5000), 20000),
    });

    const header = [
      'refund_id',
      'order_id',
      'order_number',
      'status',
      'amount',
      'currency',
      'requester_role',
      'created_at',
      'processed_at',
      'provider_refund_id',
    ];
    const rows = refunds.map((refund) => ([
      refund.id,
      refund.orderId,
      refund.order?.orderNumber || '',
      refund.status,
      toMoney(refund.amount).toFixed(2),
      refund.order?.currency || 'JOD',
      refund.requesterRole,
      refund.createdAt?.toISOString?.() || '',
      refund.processedAt?.toISOString?.() || '',
      refund.providerRefundId || '',
    ]));

    const csv = [header, ...rows]
      .map((fields) =>
        fields
          .map((field) => {
            const escaped = String(field ?? '').replace(/\"/g, '\"\"');
            return `\"${escaped}\"`;
          })
          .join(','),
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=\"refund-reconciliation-${new Date().toISOString().slice(0, 10)}.csv\"`,
    );
    return res.status(200).send(csv);
  } catch (error) {
    console.error('Refund reconciliation export error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to export reconciliation data' });
  }
});

module.exports = router;
