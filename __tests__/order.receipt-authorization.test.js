const { isRestaurantBuyerReceiptConfirmation } = require('../src/utils/order-status-authorization');

describe('B2B receipt confirmation authorization', () => {
  const order = { userId: 'restaurant-buyer' };

  test('allows only the purchasing Restaurant Owner to complete delivery', () => {
    expect(isRestaurantBuyerReceiptConfirmation({
      user: { id: 'restaurant-buyer', role: 'restaurant_owner' },
      order,
      nextStatus: 'completed',
    })).toBe(true);
    expect(isRestaurantBuyerReceiptConfirmation({
      user: { id: 'other-restaurant', role: 'restaurant_owner' },
      order,
      nextStatus: 'completed',
    })).toBe(false);
    expect(isRestaurantBuyerReceiptConfirmation({
      user: { id: 'restaurant-buyer', role: 'restaurant_owner' },
      order,
      nextStatus: 'delivered',
    })).toBe(false);
  });
});
