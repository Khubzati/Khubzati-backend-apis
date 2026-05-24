const PAYMENT_METHODS = {
  ONLINE_CARD: 'online_card',
  CASH_ON_DELIVERY: 'cash_on_delivery',
  CREDIT_CARD: 'credit_card',
  DEBIT_CARD: 'debit_card',
  WALLET: 'wallet',
};

const PAYMENT_STATUSES = {
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  COD_PENDING: 'cod_pending',
  COD_COLLECTED: 'cod_collected',
};

const PAYMENT_PROVIDERS = {
  STRIPE: 'stripe',
  NOON: 'noon',
  COD: 'cod',
};

const normalizePaymentMethod = (value) => {
  if (!value) return PAYMENT_METHODS.ONLINE_CARD;
  const normalized = String(value).trim().toLowerCase();

  if (normalized === 'online_card' || normalized === 'online') return PAYMENT_METHODS.ONLINE_CARD;
  if (normalized === 'cash_on_delivery' || normalized === 'cod' || normalized === 'cash') {
    return PAYMENT_METHODS.CASH_ON_DELIVERY;
  }
  if (normalized === PAYMENT_METHODS.CREDIT_CARD) return PAYMENT_METHODS.CREDIT_CARD;
  if (normalized === PAYMENT_METHODS.DEBIT_CARD) return PAYMENT_METHODS.DEBIT_CARD;
  if (normalized === PAYMENT_METHODS.WALLET) return PAYMENT_METHODS.WALLET;

  return normalized;
};

const isCashOnDelivery = (method) =>
  normalizePaymentMethod(method) === PAYMENT_METHODS.CASH_ON_DELIVERY;

const isOnlinePaymentMethod = (method) => !isCashOnDelivery(method);

module.exports = {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_PROVIDERS,
  normalizePaymentMethod,
  isCashOnDelivery,
  isOnlinePaymentMethod,
};
