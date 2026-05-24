class PaymentProvider {
  constructor(providerName) {
    this.providerName = providerName;
  }

  // eslint-disable-next-line class-methods-use-this
  async createCheckoutSession() {
    throw new Error('createCheckoutSession() must be implemented by payment provider');
  }

  // eslint-disable-next-line class-methods-use-this
  verifyAndConstructWebhookEvent() {
    throw new Error('verifyAndConstructWebhookEvent() must be implemented by payment provider');
  }
}

module.exports = { PaymentProvider };
