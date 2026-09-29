const ALLOWED_ORDER_TRANSITIONS = Object.freeze({
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
});

const canTransitionOrder = (from, to) =>
  (ALLOWED_ORDER_TRANSITIONS[from] || []).includes(to);

module.exports = { ALLOWED_ORDER_TRANSITIONS, canTransitionOrder };
