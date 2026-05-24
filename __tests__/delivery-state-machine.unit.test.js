const {
  normalizeDeliveryAssignmentStatus,
  canTransitionDeliveryAssignmentStatus,
} = require('../src/utils/delivery-state-machine');

describe('delivery state machine unit tests', () => {
  test('normalizes aliases', () => {
    expect(normalizeDeliveryAssignmentStatus('on_the_way')).toBe('out_for_delivery');
    expect(normalizeDeliveryAssignmentStatus(' PICKED_UP ')).toBe('picked_up');
  });

  test('allows valid transitions', () => {
    expect(canTransitionDeliveryAssignmentStatus('assigned', 'accepted')).toBe(true);
    expect(canTransitionDeliveryAssignmentStatus('accepted', 'picked_up')).toBe(true);
    expect(canTransitionDeliveryAssignmentStatus('picked_up', 'out_for_delivery')).toBe(true);
    expect(canTransitionDeliveryAssignmentStatus('out_for_delivery', 'delivered')).toBe(true);
  });

  test('blocks invalid transitions', () => {
    expect(canTransitionDeliveryAssignmentStatus('delivered', 'picked_up')).toBe(false);
    expect(canTransitionDeliveryAssignmentStatus('assigned', 'delivered')).toBe(false);
  });
});
