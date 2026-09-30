import { quantizeToCurrency } from "@/lib/intl/money";

/**
 * How far one refund may reach on an order. The refund dialog and both refund
 * routes work it out here, so the figure the admin is shown is the figure the
 * server holds them to.
 *
 * Every figure is kept at the currency's own precision. In binary floating
 * point 741.99 − 702 − 39.99 is 1.4e-14, not 0: the dialog read that as money
 * still to refund, opened on "Refundable: $0.00", and its Confirm sent the
 * crumb to the gateway.
 */
interface OrderRefundRoom {
  /** What a refund reaches without naming the delivery: goods and their tax. */
  goodsLeft: number;
  /** The part of the held-back delivery this refund hands back anyway. */
  deliveryOverride: number;
  /** The most this refund may be. */
  limit: number;
  /** The most the order's refunded total may read once this refund is in. */
  claimCeiling: number;
}

export function orderRefundRoom(params: {
  /** What the order collected — see `getOrderRefundCeiling`. */
  ceiling: number;
  /** Refunded on the order so far. */
  refunded: number;
  /**
   * Delivery a refund leaves out unless it is named — see
   * `unrefundableDeliveryFor`. The carrier was paid when the parcel left.
   */
  heldDelivery: number;
  /**
   * Delivery this refund names. Naming it is the override that hands the
   * held-back part back: deliberately, never as a side effect of "Full".
   */
  namedDelivery?: number;
  currency: string;
}): OrderRefundRoom {
  const money = (value: number) =>
    quantizeToCurrency(Math.max(0, Number(value) || 0), params.currency);
  const refunded = money(params.refunded);
  const collectedLeft = money(Number(params.ceiling) - refunded);
  const held = Math.min(money(params.heldDelivery), collectedLeft);
  const goodsLeft = money(collectedLeft - held);
  const deliveryOverride = Math.min(held, money(params.namedDelivery ?? 0));
  const limit = money(goodsLeft + deliveryOverride);
  return {
    goodsLeft,
    deliveryOverride,
    limit,
    claimCeiling: money(refunded + limit),
  };
}
