const isRestaurantBuyerReceiptConfirmation = ({ user, order, nextStatus }) =>
  user?.role === 'restaurant_owner' &&
  user?.id === order?.userId &&
  nextStatus === 'completed';

module.exports = { isRestaurantBuyerReceiptConfirmation };
