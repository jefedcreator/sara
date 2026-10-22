/**
 * Products can only be paid for online once the business can take payments
 * and has at least one way for the customer to get the order.
 */
export function canSellOnline({
  isPaymentReady,
  offersDelivery,
  offersPickup,
}: {
  isPaymentReady: boolean;
  offersDelivery: boolean;
  offersPickup: boolean;
}) {
  return isPaymentReady && (offersDelivery || offersPickup);
}
