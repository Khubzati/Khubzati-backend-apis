const Stripe = require('stripe');
const { PaymentProvider } = require('./payment-provider');
const { PAYMENT_PROVIDERS } = require('./payment-constants');

class StripePaymentProvider extends PaymentProvider {
  constructor(config = {}) {
    super(PAYMENT_PROVIDERS.STRIPE);
    this.secretKey = config.secretKey || process.env.STRIPE_SECRET_KEY;
    this.webhookSecret = config.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
    this.allowCurrencyFallback =
      String(
        config.allowCurrencyFallback ??
          process.env.ENABLE_STRIPE_CURRENCY_FALLBACK ??
          'true',
      ).toLowerCase() === 'true';
    this.fallbackCurrency = String(
      config.fallbackCurrency || process.env.STRIPE_FALLBACK_CURRENCY || 'usd',
    )
      .trim()
      .toLowerCase();
    const parsedFallbackRate = Number(
      config.fallbackRate ?? process.env.STRIPE_FALLBACK_RATE ?? 1,
    );
    this.fallbackRate =
      Number.isFinite(parsedFallbackRate) && parsedFallbackRate > 0
        ? parsedFallbackRate
        : 1;
    this.stripe = this.secretKey ? new Stripe(this.secretKey) : null;
  }

  assertConfigured() {
    if (!this.stripe) {
      throw new Error('Stripe is not configured. Missing STRIPE_SECRET_KEY.');
    }
  }

  buildLineItems(order, currency, conversionRate = 1) {
    return (order.orderItems || []).map((item, index) => {
      const basePrice = Number(item.price);
      const adjustedPrice = Number.isFinite(basePrice) ? basePrice * conversionRate : 0;
      const unitAmount = Math.max(1, Math.round(adjustedPrice * 100));
      const name = item.product?.name || `Order item ${index + 1}`;
      const imageUrl = item.product?.imageUrl;
      const imageIsHttp = typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl);

      return {
        quantity: item.quantity,
        price_data: {
          currency,
          unit_amount: unitAmount,
          product_data: {
            name,
            ...(imageIsHttp ? { images: [imageUrl] } : {}),
          },
        },
      };
    });
  }

  computeAmountFromLineItems(lineItems) {
    const minorUnits = lineItems.reduce((sum, item) => {
      const quantity = Number(item.quantity || 0);
      const unitAmount = Number(item?.price_data?.unit_amount || 0);
      return sum + unitAmount * quantity;
    }, 0);
    return minorUnits / 100;
  }

  async createSessionWithCurrency({
    order,
    successUrl,
    cancelUrl,
    currency,
    conversionRate,
    fallbackApplied,
    originalCurrency,
  }) {
    const lineItems = this.buildLineItems(order, currency, conversionRate);
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      client_reference_id: order.id,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        originalCurrency: String(originalCurrency || currency).toUpperCase(),
        chargeCurrency: String(currency).toUpperCase(),
        fallbackApplied: fallbackApplied ? 'true' : 'false',
      },
      payment_intent_data: {
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          originalCurrency: String(originalCurrency || currency).toUpperCase(),
          chargeCurrency: String(currency).toUpperCase(),
          fallbackApplied: fallbackApplied ? 'true' : 'false',
        },
      },
    });

    return {
      provider: PAYMENT_PROVIDERS.STRIPE,
      checkoutUrl: session.url,
      providerSessionId: session.id,
      providerPaymentId:
        typeof session.payment_intent === 'string' ? session.payment_intent : null,
      currency: String(currency).toUpperCase(),
      originalCurrency: String(originalCurrency || currency).toUpperCase(),
      conversionRate,
      fallbackApplied,
      paymentAmount: this.computeAmountFromLineItems(lineItems),
      raw: session,
    };
  }

  isInvalidCurrencyError(error, attemptedCurrency) {
    const message = String(error?.message || error?.raw?.message || '').toLowerCase();
    const rawParam = String(error?.raw?.param || error?.param || '').toLowerCase();
    const rawType = String(error?.raw?.type || error?.rawType || '').toLowerCase();
    const referencesCurrencyParam = rawParam.includes('currency');
    const invalidRequestCurrency =
      rawType === 'invalid_request_error' && message.includes('invalid currency');
    return (
      (message.includes('invalid currency') &&
        message.includes(String(attemptedCurrency || '').toLowerCase())) ||
      referencesCurrencyParam ||
      invalidRequestCurrency
    );
  }

  async createCheckoutSession({ order, successUrl, cancelUrl }) {
    this.assertConfigured();

    const orderCurrency = String(order.currency || 'jod').trim().toLowerCase();
    try {
      return await this.createSessionWithCurrency({
        order,
        successUrl,
        cancelUrl,
        currency: orderCurrency,
        conversionRate: 1,
        fallbackApplied: false,
        originalCurrency: orderCurrency,
      });
    } catch (error) {
      const canFallback =
        this.fallbackCurrency &&
        this.fallbackCurrency !== orderCurrency &&
        this.isInvalidCurrencyError(error, orderCurrency) &&
        this.allowCurrencyFallback;

      if (!canFallback) {
        throw error;
      }

      // Single controlled retry using a fallback currency when Stripe account
      // doesn't support the order currency.
      console.warn(
        `[StripePaymentProvider] Currency fallback: ${orderCurrency} -> ${this.fallbackCurrency} for order ${order.id}`,
      );
      return this.createSessionWithCurrency({
        order,
        successUrl,
        cancelUrl,
        currency: this.fallbackCurrency,
        conversionRate: this.fallbackRate,
        fallbackApplied: true,
        originalCurrency: orderCurrency,
      });
    }
  }

  verifyAndConstructWebhookEvent(rawBody, signatureHeader) {
    this.assertConfigured();

    if (!this.webhookSecret) {
      throw new Error('Stripe webhook secret is not configured. Missing STRIPE_WEBHOOK_SECRET.');
    }

    return this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
  }

  async createRefund({ paymentIntentId, amount, metadata = {} }) {
    this.assertConfigured();

    const payload = {
      payment_intent: paymentIntentId,
      metadata,
    };

    if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
      payload.amount = Math.round(amount * 100);
    }

    return this.stripe.refunds.create(payload);
  }
}

module.exports = { StripePaymentProvider };
