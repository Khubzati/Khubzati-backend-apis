const ORDER_STATUSES = Object.freeze([
  'pending',
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'out_for_delivery',
  'delivered',
  'completed',
  'cancelled',
]);

const ORDER_STATUS_SET = new Set(ORDER_STATUSES);

const ORDER_STATUS_ALIASES = Object.freeze({
  accepted: 'confirmed',
  processing: 'preparing',
  in_progress: 'preparing',
  ready: 'ready_for_pickup',
  canceled: 'cancelled',
});

function normalizeOrderStatus(status) {
  if (typeof status !== 'string') return null;
  const normalized = status.trim().toLowerCase();
  if (!normalized) return null;
  return ORDER_STATUS_ALIASES[normalized] || normalized;
}

function resolveOrderStatus(status) {
  const normalized = normalizeOrderStatus(status);
  if (!normalized) return null;
  return ORDER_STATUS_SET.has(normalized) ? normalized : null;
}

module.exports = {
  ORDER_STATUSES,
  resolveOrderStatus,
};
