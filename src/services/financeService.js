const toMoney = (value) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
};

const resolveVendorContext = (order) => {
  if (order.bakeryId) return { vendorType: 'bakery', vendorId: order.bakeryId };
  if (order.restaurantId) return { vendorType: 'restaurant', vendorId: order.restaurantId };
  return { vendorType: null, vendorId: null };
};

const getApplicableCommissionRateBps = async ({ prisma, vendorType, vendorId }) => {
  if (vendorType && vendorId) {
    const vendorConfig = await prisma.commissionConfig.findFirst({
      where: {
        scope: 'vendor',
        vendorType,
        vendorId,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (vendorConfig) {
      return vendorConfig.rateBps;
    }
  }

  const globalConfig = await prisma.commissionConfig.findFirst({
    where: {
      scope: 'global',
      isActive: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return globalConfig ? globalConfig.rateBps : 1000;
};

const ensureOrderFinancialRecord = async ({ prisma, orderId }) => {
  const existing = await prisma.orderFinancialRecord.findUnique({
    where: { orderId },
  });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    const error = new Error('Order not found');
    error.statusCode = 404;
    throw error;
  }

  const { vendorType, vendorId } = resolveVendorContext(order);
  const commissionRateBps = await getApplicableCommissionRateBps({
    prisma,
    vendorType,
    vendorId,
  });

  const grossAmount = toMoney(order.totalAmount);
  const commissionAmount = toMoney((grossAmount * commissionRateBps) / 10000);
  const vendorNetAmount = toMoney(grossAmount - commissionAmount);

  const data = {
    grossAmount,
    commissionRateBps,
    commissionAmount,
    vendorNetAmount,
    netPlatformAmount: toMoney(commissionAmount - Number(existing?.refundedAmount || 0)),
    snapshot: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      vendorType,
      vendorId,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      capturedAt: new Date().toISOString(),
    },
  };

  if (existing) {
    return prisma.orderFinancialRecord.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.orderFinancialRecord.create({
    data: {
      orderId,
      ...data,
    },
  });
};

const appendFinancialTransaction = async ({
  prisma,
  orderId = null,
  refundRequestId = null,
  payoutRequestId = null,
  transactionType,
  status,
  amount,
  currency = 'JOD',
  provider = null,
  providerReference = null,
  metadata = null,
}) =>
  prisma.financialTransaction.create({
    data: {
      orderId,
      refundRequestId,
      payoutRequestId,
      transactionType,
      status,
      amount: toMoney(amount),
      currency,
      provider,
      providerReference,
      metadata: metadata || null,
    },
  });

const getVendorAvailableBalance = async ({ prisma, vendorType, vendorId }) => {
  if (!vendorType || !vendorId) return 0;

  const financialRecords = await prisma.orderFinancialRecord.findMany({
    where:
      vendorType === 'bakery'
        ? { order: { is: { bakeryId: vendorId } } }
        : { order: { is: { restaurantId: vendorId } } },
    select: {
      vendorNetAmount: true,
      refundedAmount: true,
      payoutAmount: true,
    },
  });

  const ledgerAvailable = financialRecords.reduce((sum, record) => {
    const vendorNet = toMoney(record.vendorNetAmount);
    const refunded = toMoney(record.refundedAmount);
    const payout = toMoney(record.payoutAmount);
    return sum + (vendorNet - refunded - payout);
  }, 0);

  const reservedPayouts = await prisma.payoutRequest.aggregate({
    _sum: { amount: true },
    where: {
      vendorType,
      vendorId,
      status: { in: ['requested', 'approved', 'paid'] },
    },
  });

  return toMoney(ledgerAvailable - toMoney(reservedPayouts._sum.amount || 0));
};

module.exports = {
  toMoney,
  resolveVendorContext,
  getApplicableCommissionRateBps,
  ensureOrderFinancialRecord,
  appendFinancialTransaction,
  getVendorAvailableBalance,
};
