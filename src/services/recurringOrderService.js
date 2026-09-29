const {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_PROVIDERS,
  normalizePaymentMethod,
  isCashOnDelivery,
} = require('./payments/payment-constants');

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 50;

const asSafeInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const generateOrderNumber = () =>
  `KHB-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

const createRecurringError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

class RecurringOrderService {
  constructor({ prisma }) {
    this.prisma = prisma;
  }

  normalizeRepeatMode(value) {
    const normalized = String(value || 'one_time').trim().toLowerCase();
    return normalized === 'daily' ? 'daily' : 'one_time';
  }

  isDailyRepeat(value) {
    return this.normalizeRepeatMode(value) === 'daily';
  }

  buildTemplateSignature({
    userId,
    bakeryId,
    restaurantId,
    deliveryAddressId,
    orderType,
    paymentMethod,
    items,
  }) {
    const vendorScope = bakeryId
      ? `bakery:${bakeryId}`
      : `restaurant:${restaurantId || ''}`;
    const compactItems = [...(items || [])]
      .map((item) => ({
        productId: String(item.productId || '').trim(),
        quantity: asSafeInt(item.quantity, 0),
      }))
      .filter((item) => item.productId && item.quantity > 0)
      .sort((a, b) => a.productId.localeCompare(b.productId))
      .map((item) => `${item.productId}:${item.quantity}`)
      .join('|');

    return [
      userId,
      vendorScope,
      deliveryAddressId || '',
      orderType || 'delivery',
      normalizePaymentMethod(paymentMethod),
      compactItems,
    ].join('::');
  }

  _buildTemplateItems(orderItems) {
    return (orderItems || [])
      .map((item) => ({
        productId: String(item.productId || '').trim(),
        quantity: asSafeInt(item.quantity, 0),
        specialInstructions: item.specialInstructions
          ? String(item.specialInstructions)
          : null,
      }))
      .filter((item) => item.productId && item.quantity > 0);
  }

  async upsertDailyTemplateFromOrder({
    userId,
    bakeryId,
    restaurantId,
    orderType,
    deliveryAddressId,
    paymentMethod,
    specialInstructions,
    orderItems,
    sourceOrderId,
  }) {
    const items = this._buildTemplateItems(orderItems);
    if (!items.length) {
      throw createRecurringError(
        'RECURRING_ITEMS_INVALID',
        'Recurring order requires at least one valid item.',
      );
    }

    const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
    if (!isCashOnDelivery(normalizedPaymentMethod)) {
      throw createRecurringError(
        'RECURRING_PAYMENT_UNSUPPORTED',
        'Daily recurring orders currently support cash on delivery only.',
      );
    }

    const signature = this.buildTemplateSignature({
      userId,
      bakeryId,
      restaurantId,
      deliveryAddressId,
      orderType,
      paymentMethod: normalizedPaymentMethod,
      items,
    });

    const nextRunAt = new Date(Date.now() + DAILY_INTERVAL_MS);

    return this.prisma.recurringOrder.upsert({
      where: { signature },
      update: {
        isActive: true,
        frequency: 'daily',
        userId,
        bakeryId: bakeryId || null,
        restaurantId: restaurantId || null,
        orderType: orderType || 'delivery',
        deliveryAddressId: deliveryAddressId || null,
        paymentMethod: normalizedPaymentMethod,
        paymentProvider: PAYMENT_PROVIDERS.COD,
        specialInstructions: specialInstructions || null,
        itemsJson: items,
        sourceOrderId: sourceOrderId || null,
        nextRunAt,
        lastError: null,
      },
      create: {
        signature,
        frequency: 'daily',
        isActive: true,
        userId,
        bakeryId: bakeryId || null,
        restaurantId: restaurantId || null,
        orderType: orderType || 'delivery',
        deliveryAddressId: deliveryAddressId || null,
        paymentMethod: normalizedPaymentMethod,
        paymentProvider: PAYMENT_PROVIDERS.COD,
        specialInstructions: specialInstructions || null,
        itemsJson: items,
        sourceOrderId: sourceOrderId || null,
        nextRunAt,
      },
    });
  }

  async runDueRenewals({
    now = new Date(),
    batchSize = DEFAULT_BATCH_SIZE,
  } = {}) {
    const dueTemplates = await this.prisma.recurringOrder.findMany({
      where: {
        isActive: true,
        frequency: 'daily',
        nextRunAt: { lte: now },
      },
      orderBy: { nextRunAt: 'asc' },
      take: batchSize,
    });

    if (!dueTemplates.length) {
      return { processed: 0, createdOrders: 0, failed: 0 };
    }

    let createdOrders = 0;
    let failed = 0;

    for (const template of dueTemplates) {
      try {
        await this._renewTemplate(template, now);
        createdOrders += 1;
      } catch (error) {
        failed += 1;
        await this.prisma.recurringOrder.update({
          where: { id: template.id },
          data: {
            lastError: String(error?.message || 'Unknown recurring renewal error').slice(0, 1000),
            lastRunAt: now,
            nextRunAt: new Date(now.getTime() + DAILY_INTERVAL_MS),
          },
        });
      }
    }

    return { processed: dueTemplates.length, createdOrders, failed };
  }

  async _renewTemplate(template, now) {
    const rawItems = Array.isArray(template.itemsJson) ? template.itemsJson : [];
    const items = this._buildTemplateItems(rawItems);
    if (!items.length) {
      throw createRecurringError(
        'RECURRING_ITEMS_INVALID',
        'Recurring template has no valid items.',
      );
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    const requestedQtyByProductId = new Map();
    for (const item of items) {
      requestedQtyByProductId.set(
        item.productId,
        (requestedQtyByProductId.get(item.productId) || 0) + item.quantity,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          deletedAt: null,
          isAvailable: true,
        },
      });

      const productMap = new Map(products.map((product) => [product.id, product]));
      for (const productId of productIds) {
        if (!productMap.has(productId)) {
          throw createRecurringError(
            'RECURRING_PRODUCT_UNAVAILABLE',
            `Recurring product ${productId} is unavailable.`,
          );
        }
      }

      for (const product of products) {
        if (template.bakeryId && product.bakeryId !== template.bakeryId) {
          throw createRecurringError(
            'RECURRING_VENDOR_MISMATCH',
            `Product "${product.name}" no longer belongs to this bakery.`,
          );
        }
        if (template.restaurantId && product.restaurantId !== template.restaurantId) {
          throw createRecurringError(
            'RECURRING_VENDOR_MISMATCH',
            `Product "${product.name}" no longer belongs to this restaurant.`,
          );
        }
      }

      for (const [productId, requestedQuantity] of requestedQtyByProductId.entries()) {
        const updated = await tx.product.updateMany({
          where: {
            id: productId,
            deletedAt: null,
            isAvailable: true,
            stockQuantity: { gte: requestedQuantity },
          },
          data: {
            stockQuantity: { decrement: requestedQuantity },
            updatedBy: template.userId,
          },
        });

        if (updated.count === 0) {
          const product = await tx.product.findUnique({
            where: { id: productId },
            select: { name: true, stockQuantity: true },
          });
          throw createRecurringError(
            'RECURRING_STOCK_INSUFFICIENT',
            `Insufficient inventory for recurring item "${product?.name || productId}". Available: ${product?.stockQuantity ?? 0}, requested: ${requestedQuantity}`,
          );
        }
      }

      const orderItems = [];
      let totalAmount = 0;
      for (const item of items) {
        const product = productMap.get(item.productId);
        const unitPrice = Number.parseFloat(product.price);
        const subtotal = unitPrice * item.quantity;
        totalAmount += subtotal;
        orderItems.push({
          productId: item.productId,
          quantity: item.quantity,
          price: unitPrice,
          subtotal,
          specialInstructions: item.specialInstructions,
        });
      }

      const order = await tx.order.create({
        data: {
          userId: template.userId,
          bakeryId: template.bakeryId || null,
          restaurantId: template.restaurantId || null,
          orderNumber: generateOrderNumber(),
          status: 'confirmed',
          orderType: template.orderType || 'delivery',
          deliveryAddressId: template.deliveryAddressId || null,
          totalAmount,
          paymentMethod: PAYMENT_METHODS.CASH_ON_DELIVERY,
          paymentStatus: PAYMENT_STATUSES.COD_PENDING,
          paymentProvider: PAYMENT_PROVIDERS.COD,
          paymentAmount: totalAmount,
          currency: String(process.env.DEFAULT_CURRENCY || 'JOD').toUpperCase(),
          specialInstructions: template.specialInstructions || null,
          createdBy: template.userId,
          orderItems: {
            create: orderItems,
          },
        },
      });

      await tx.recurringOrder.update({
        where: { id: template.id },
        data: {
          lastRunAt: now,
          lastOrderId: order.id,
          lastError: null,
          nextRunAt: new Date(now.getTime() + DAILY_INTERVAL_MS),
        },
      });
    });
  }
}

module.exports = {
  RecurringOrderService,
};

