const { PaymentProvider } = require('./payment-provider');
const { PAYMENT_PROVIDERS } = require('./payment-constants');

class NoonPaymentProvider extends PaymentProvider {
  constructor() {
    super(PAYMENT_PROVIDERS.NOON);
  }

  async createCheckoutSession() {
    throw new Error('Noon payment provider is not enabled yet.');
  }

  verifyAndConstructWebhookEvent() {
    throw new Error('Noon webhook handler is not implemented yet.');
  }
}

module.exports = { NoonPaymentProvider };
