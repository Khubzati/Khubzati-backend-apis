const express = require('express');
const prisma = require('../lib/prisma');
const { authenticateToken } = require('../middleware/auth');
const { PaymentService } = require('../services/payments/payment-service');

const router = express.Router();
const paymentService = new PaymentService({ prisma });

const buildRedirectUrl = (baseUrl, fallbackPath) => {
  const candidate = String(baseUrl || '').trim();
  if (candidate) {
    return candidate;
  }

  const appUrl = String(process.env.APP_BASE_URL || process.env.FRONTEND_BASE_URL || 'http://localhost:3004').replace(/\/$/, '');
  return `${appUrl}${fallbackPath}`;
};

const isAllowedClientRedirectUrl = (candidate) => {
  const value = String(candidate || '').trim();
  if (!value) return false;
  return /^khubzati:\/\//i.test(value);
};

const resolveRedirectUrl = (clientProvided, envValue, fallbackPath) => {
  if (isAllowedClientRedirectUrl(clientProvided)) {
    return String(clientProvided).trim();
  }
  return buildRedirectUrl(envValue, fallbackPath);
};

const appendQueryParams = (url, params = {}) => {
  const entries = Object.entries(params).filter(
    ([, value]) => value !== null && value !== undefined && String(value).trim() !== '',
  );
  if (!entries.length) return url;

  const separator = url.includes('?') ? '&' : '?';
  const query = entries
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value).trim())}`,
    )
    .join('&');
  return `${url}${separator}${query}`;
};

const appendSessionPlaceholder = (url) => {
  if (url.includes('{CHECKOUT_SESSION_ID}')) {
    return url;
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}session_id={CHECKOUT_SESSION_ID}`;
};

router.post('/create-session', authenticateToken, async (req, res) => {
  try {
    const { orderId, successUrl: clientSuccessUrl, cancelUrl: clientCancelUrl } = req.body;

    if (!orderId) {
      return res.status(400).json({
        status: 'fail',
        message: 'orderId is required',
      });
    }

    const successBase = resolveRedirectUrl(
      clientSuccessUrl,
      process.env.STRIPE_SUCCESS_URL,
      '/checkout/success',
    );
    const cancelBase = resolveRedirectUrl(
      clientCancelUrl,
      process.env.STRIPE_CANCEL_URL,
      '/checkout/cancel',
    );
    const successUrl = appendSessionPlaceholder(
      appendQueryParams(successBase, { orderId, source: 'stripe' }),
    );
    const cancelUrl = appendQueryParams(cancelBase, {
      orderId,
      source: 'stripe',
      cancelled: 'true',
    });

    const session = await paymentService.createCheckoutSession({
      orderId,
      userId: req.user.id,
      successUrl,
      cancelUrl,
    });

    return res.status(200).json({
      status: 'success',
      data: session,
    });
  } catch (error) {
    console.error('Create payment session error:', error);
    return res.status(error.statusCode || 500).json({
      status: 'error',
      message: error.message || 'Unable to create payment session',
    });
  }
});

// Backward compatibility alias
router.post('/initiate', authenticateToken, async (req, res) => {
  try {
    const { orderId, successUrl: clientSuccessUrl, cancelUrl: clientCancelUrl } = req.body;

    if (!orderId) {
      return res.status(400).json({ status: 'fail', message: 'orderId is required' });
    }

    const successBase = resolveRedirectUrl(
      clientSuccessUrl,
      process.env.STRIPE_SUCCESS_URL,
      '/checkout/success',
    );
    const cancelBase = resolveRedirectUrl(
      clientCancelUrl,
      process.env.STRIPE_CANCEL_URL,
      '/checkout/cancel',
    );
    const successUrl = appendSessionPlaceholder(
      appendQueryParams(successBase, { orderId, source: 'stripe' }),
    );
    const cancelUrl = appendQueryParams(cancelBase, {
      orderId,
      source: 'stripe',
      cancelled: 'true',
    });

    const session = await paymentService.createCheckoutSession({
      orderId,
      userId: req.user.id,
      successUrl,
      cancelUrl,
    });

    return res.status(200).json({
      status: 'success',
      data: {
        checkoutUrl: session.checkoutUrl,
        providerSessionId: session.providerSessionId,
        paymentIntentId: session.providerPaymentId,
      },
    });
  } catch (error) {
    console.error('Initiate payment error:', error);
    return res.status(error.statusCode || 500).json({
      status: 'error',
      message: error.message || 'Unable to initiate payment',
    });
  }
});

const handleStripeWebhook = async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];

    if (!signature) {
      return res.status(400).json({
        status: 'fail',
        message: 'Missing stripe-signature header',
      });
    }

    const result = await paymentService.processStripeWebhook({
      rawBody: req.body,
      signatureHeader: signature,
    });

    return res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    const statusCode = error.message?.includes('signature') ? 400 : 500;
    return res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Webhook processing failed',
    });
  }
};

router.post('/webhooks/stripe', handleStripeWebhook);
// Backward compatibility alias
router.post('/webhook', handleStripeWebhook);

module.exports = router;
