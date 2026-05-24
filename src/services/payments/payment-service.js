const {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_PROVIDERS,
  normalizePaymentMethod,
  isCashOnDelivery,
} = require('./payment-constants');
const { StripePaymentProvider } = require('./stripe-payment-provider');
const { NoonPaymentProvider } = require('./noon-payment-provider');
const { orderEmailService } = require('../orderEmailService');
const {
  ensureOrderFinancialRecord,
  appendFinancialTransaction,
} = require('../financeService');

const DEFAULT_CURRENCY = String(process.env.DEFAULT_CURRENCY || 'JOD').toUpperCase();

class PaymentService {
  constructor({ prisma }) {
    this.prisma = prisma;
    this.stripeProvider = new StripePaymentProvider();
    this.noonProvider = new NoonPaymentProvider();
  }

  isNoonEnabled() {
    return String(process.env.ENABLE_NOON_PAYMENTS || 'false').toLowerCase() === 'true';
  }

  normalizeCurrency(currency) {
    const normalized = String(currency || DEFAULT_CURRENCY).toUpperCase();
    return /^[A-Z]{3}$/.test(normalized) ? normalized : DEFAULT_CURRENCY;
  }

  calculateOrderAmount(order) {
    const items = Array.isArray(order.orderItems) ? order.orderItems : [];
    return items.reduce((acc, item) => {
      const subtotal = Number(item.subtotal ?? Number(item.price) * Number(item.quantity));
      return acc + (Number.isFinite(subtotal) ? subtotal : 0);
    }, 0);
  }

  resolveProviderForOrder(order) {
    if (isCashOnDelivery(order.paymentMethod)) {
      return PAYMENT_PROVIDERS.COD;
    }

    if (this.isNoonEnabled() && order.paymentProvider === PAYMENT_PROVIDERS.NOON) {
      return PAYMENT_PROVIDERS.NOON;
    }

    return PAYMENT_PROVIDERS.STRIPE;
  }

  async getOrderForPayment({ orderId, userId }) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                name: true,
                imageUrl: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      const error = new Error('Order not found');
      error.statusCode = 404;
      throw error;
    }

    if (order.userId !== userId) {
      const error = new Error('You do not have access to this order');
      error.statusCode = 403;
      throw error;
    }

    return order;
  }

  async createCheckoutSession({ orderId, userId, successUrl, cancelUrl }) {
    const order = await this.getOrderForPayment({ orderId, userId });

    const normalizedMethod = normalizePaymentMethod(order.paymentMethod);
    if (isCashOnDelivery(normalizedMethod)) {
      const error = new Error('Cash on delivery orders do not require online payment session');
      error.statusCode = 400;
      throw error;
    }

    if ([PAYMENT_STATUSES.PAID, PAYMENT_STATUSES.COD_COLLECTED].includes(order.paymentStatus)) {
      const error = new Error('Order is already paid');
      error.statusCode = 409;
      throw error;
    }

    if (order.providerSessionId) {
      const error = new Error('A payment session already exists for this order');
      error.statusCode = 409;
      throw error;
    }

    const calculatedAmount = this.calculateOrderAmount(order);
    const orderAmount = Number(order.totalAmount);
    if (Math.abs(calculatedAmount - orderAmount) > 0.01) {
      const error = new Error('Order amount validation failed');
      error.statusCode = 400;
      throw error;
    }

    const currency = this.normalizeCurrency(order.currency);
    const providerKey = this.resolveProviderForOrder(order);

    let provider;
    if (providerKey === PAYMENT_PROVIDERS.NOON) {
      provider = this.noonProvider;
    } else {
      provider = this.stripeProvider;
    }

    const providerResult = await provider.createCheckoutSession({
      order: {
        ...order,
        currency,
      },
      successUrl,
      cancelUrl,
    });

    const chargedCurrency = this.normalizeCurrency(providerResult.currency || currency);
    const chargedAmountRaw = Number(providerResult.paymentAmount);
    const chargedAmount =
      Number.isFinite(chargedAmountRaw) && chargedAmountRaw > 0
        ? chargedAmountRaw
        : Number(order.totalAmount);

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        paymentMethod: PAYMENT_METHODS.ONLINE_CARD,
        paymentStatus: PAYMENT_STATUSES.PENDING,
        paymentProvider: providerResult.provider,
        providerSessionId: providerResult.providerSessionId,
        providerPaymentId: providerResult.providerPaymentId,
        paymentIntentId: providerResult.providerPaymentId,
        paymentAmount: chargedAmount,
        currency: chargedCurrency,
        updatedBy: userId,
      },
    });

    await ensureOrderFinancialRecord({ prisma: this.prisma, orderId: order.id });
    await appendFinancialTransaction({
      prisma: this.prisma,
      orderId: order.id,
      transactionType: 'order_payment',
      status: 'pending',
      amount: chargedAmount,
      currency: chargedCurrency,
      provider: providerResult.provider,
      providerReference: providerResult.providerPaymentId,
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      provider: providerResult.provider,
      providerSessionId: providerResult.providerSessionId,
      providerPaymentId: providerResult.providerPaymentId,
      checkoutUrl: providerResult.checkoutUrl,
      amount: chargedAmount,
      currency: chargedCurrency,
      orderCurrency: this.normalizeCurrency(order.currency),
      currencyFallbackApplied: Boolean(providerResult.fallbackApplied),
      currencyConversionRate: providerResult.conversionRate || 1,
    };
  }

  extractStripeOrderReference(event) {
    const object = event?.data?.object || {};

    if (event.type === 'checkout.session.completed') {
      return {
        orderId: object.metadata?.orderId || object.client_reference_id || null,
        providerSessionId: object.id || null,
        providerPaymentId:
          typeof object.payment_intent === 'string' ? object.payment_intent : null,
      };
    }

    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      return {
        orderId: object.metadata?.orderId || null,
        providerSessionId: null,
        providerPaymentId: object.id || null,
      };
    }

    return {
      orderId: null,
      providerSessionId: null,
      providerPaymentId: null,
    };
  }

  async processStripeWebhook({ rawBody, signatureHeader }) {
    const event = this.stripeProvider.verifyAndConstructWebhookEvent(rawBody, signatureHeader);
    const reference = this.extractStripeOrderReference(event);

    const supportedTypes = new Set([
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'checkout.session.completed',
    ]);

    if (!supportedTypes.has(event.type)) {
      return { duplicate: false, ignored: true, eventType: event.type };
    }

    let duplicate = false;
    let orderForEmail = null;

    await this.prisma.$transaction(async (tx) => {
      try {
        await tx.webhookEvent.create({
          data: {
            provider: PAYMENT_PROVIDERS.STRIPE,
            eventId: event.id,
            eventType: event.type,
            payload: event,
            orderId: reference.orderId,
          },
        });
      } catch (error) {
        if (error?.code === 'P2002') {
          duplicate = true;
          return;
        }
        throw error;
      }

      if (!reference.orderId) {
        return;
      }

      const existingOrder = await tx.order.findUnique({ where: { id: reference.orderId } });
      if (!existingOrder) {
        return;
      }

      const updatePayload = {
        paymentProvider: PAYMENT_PROVIDERS.STRIPE,
        providerPaymentId: reference.providerPaymentId || existingOrder.providerPaymentId,
        providerSessionId: reference.providerSessionId || existingOrder.providerSessionId,
        paymentIntentId: reference.providerPaymentId || existingOrder.paymentIntentId,
        updatedBy: 'stripe-webhook',
        paymentAmount: Number(existingOrder.totalAmount),
        currency: this.normalizeCurrency(existingOrder.currency),
      };

      if (event.type === 'checkout.session.completed') {
        const sessionStatus = event.data.object.payment_status;
        if (sessionStatus === 'paid') {
          updatePayload.paymentStatus = PAYMENT_STATUSES.PAID;
          updatePayload.paidAt = new Date();
          updatePayload.paymentErrorMessage = null;
        }
      }

      if (event.type === 'payment_intent.succeeded') {
        updatePayload.paymentStatus = PAYMENT_STATUSES.PAID;
        updatePayload.paidAt = new Date();
        updatePayload.paymentErrorMessage = null;
      }

      if (event.type === 'payment_intent.payment_failed') {
        const failureMessage =
          event.data.object?.last_payment_error?.message ||
          event.data.object?.last_payment_error?.code ||
          'Payment failed';

        updatePayload.paymentStatus = PAYMENT_STATUSES.FAILED;
        updatePayload.paymentErrorMessage = failureMessage;
      }

      await tx.order.update({
        where: { id: existingOrder.id },
        data: updatePayload,
      });

      if (updatePayload.paymentStatus === PAYMENT_STATUSES.PAID) {
        await tx.orderFinancialRecord.upsert({
          where: { orderId: existingOrder.id },
          update: {},
          create: {
            orderId: existingOrder.id,
            grossAmount: Number(existingOrder.totalAmount),
            commissionRateBps: 0,
            commissionAmount: 0,
            vendorNetAmount: Number(existingOrder.totalAmount),
            netPlatformAmount: 0,
            snapshot: {
              source: 'payment-webhook-bootstrap',
              eventType: event.type,
              capturedAt: new Date().toISOString(),
            },
          },
        });
      }

      const isNowPaid = updatePayload.paymentStatus === PAYMENT_STATUSES.PAID;
      const wasPaid = existingOrder.paymentStatus === PAYMENT_STATUSES.PAID;
      if (isNowPaid && !wasPaid) {
        orderForEmail = await tx.order.findUnique({
          where: { id: existingOrder.id },
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                username: true,
                email: true,
              },
            },
            bakery: {
              select: {
                id: true,
                name: true,
              },
            },
            restaurant: {
              select: {
                id: true,
                name: true,
              },
            },
            orderItems: {
              include: {
                product: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        });
      }
    });

    if (orderForEmail) {
      try {
        await orderEmailService.sendOrderConfirmation({ order: orderForEmail });
      } catch (emailError) {
        console.error('Payment confirmation email failed:', emailError);
      }
    }

    if (reference.orderId) {
      const settledOrder = await this.prisma.order.findUnique({ where: { id: reference.orderId } });
      await ensureOrderFinancialRecord({ prisma: this.prisma, orderId: reference.orderId });
      await appendFinancialTransaction({
        prisma: this.prisma,
        orderId: reference.orderId,
        transactionType: 'order_payment',
        status:
          event.type === 'payment_intent.payment_failed'
            ? 'failed'
            : 'paid',
        amount: Number(settledOrder?.totalAmount || 0),
        currency: this.normalizeCurrency(settledOrder?.currency),
        provider: PAYMENT_PROVIDERS.STRIPE,
        providerReference: reference.providerPaymentId,
        metadata: { eventId: event.id, eventType: event.type },
      });
    }

    return {
      duplicate,
      ignored: false,
      eventType: event.type,
      orderId: reference.orderId,
      eventId: event.id,
    };
  }

  async markCodCollected({ orderId, actorUserId }) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });

    if (!order) {
      const error = new Error('Order not found');
      error.statusCode = 404;
      throw error;
    }

    const method = normalizePaymentMethod(order.paymentMethod);
    if (!isCashOnDelivery(method)) {
      const error = new Error('This endpoint is only available for cash on delivery orders');
      error.statusCode = 400;
      throw error;
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        paymentProvider: PAYMENT_PROVIDERS.COD,
        paymentStatus: PAYMENT_STATUSES.COD_COLLECTED,
        codCollectedAt: new Date(),
        codCollectedBy: actorUserId,
        paidAt: new Date(),
        paymentAmount: Number(order.totalAmount),
        currency: this.normalizeCurrency(order.currency),
        updatedBy: actorUserId,
      },
    });

    await ensureOrderFinancialRecord({ prisma: this.prisma, orderId });
    await appendFinancialTransaction({
      prisma: this.prisma,
      orderId,
      transactionType: 'order_payment',
      status: PAYMENT_STATUSES.COD_COLLECTED,
      amount: Number(order.totalAmount),
      currency: this.normalizeCurrency(order.currency),
      provider: PAYMENT_PROVIDERS.COD,
      metadata: { actorUserId },
    });

    return updatedOrder;
  }
}

module.exports = { PaymentService };
