const DELIVERY_ASSIGNMENT_TRANSITIONS = Object.freeze({
  assigned: ['accepted', 'rejected'],
  accepted: ['picked_up', 'cancelled'],
  picked_up: ['out_for_delivery', 'failed'],
  out_for_delivery: ['delivered', 'failed'],
  rejected: [],
  failed: [],
  delivered: [],
  cancelled: [],
});

const ORDER_STATUS_BY_DELIVERY_ASSIGNMENT_STATUS = Object.freeze({
  accepted: 'out_for_delivery',
  picked_up: 'out_for_delivery',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  failed: 'cancelled',
  cancelled: 'cancelled',
});

const normalizeDeliveryAssignmentStatus = (status) => {
  if (typeof status !== 'string') return null;
  const normalized = status.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === 'on_the_way') return 'out_for_delivery';
  return normalized;
};

const canTransitionDeliveryAssignmentStatus = (fromStatus, toStatus) => {
  const normalizedFrom = normalizeDeliveryAssignmentStatus(fromStatus);
  const normalizedTo = normalizeDeliveryAssignmentStatus(toStatus);
  if (!normalizedFrom || !normalizedTo) return false;

  const allowed = DELIVERY_ASSIGNMENT_TRANSITIONS[normalizedFrom];
  if (!allowed) return false;
  return allowed.includes(normalizedTo);
};

module.exports = {
  DELIVERY_ASSIGNMENT_TRANSITIONS,
  ORDER_STATUS_BY_DELIVERY_ASSIGNMENT_STATUS,
  normalizeDeliveryAssignmentStatus,
  canTransitionDeliveryAssignmentStatus,
};
