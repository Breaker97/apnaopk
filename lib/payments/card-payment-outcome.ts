import { ORDER_STATUS } from "@/config/app.config";
import { roundMoney } from "@/lib/intl/money";
import { SOLD_OUT_AFTER_CAPTURE_CANCEL_REASON } from "@/lib/payments/finalize-order";
import type { StripePaymentRejection } from "@/lib/payments/stripe-orders";

/**
 * What a card payment became, as the success page has to tell it.
 *
 * "An order exists" was the only answer the page understood, and it is not the
 * same as "the order went through". A payment whose goods sold out while the
 * card was confirming does produce an order — cancelled and refunded in the
 * same breath — and the page thanked the shopper for it. A payment the cart no
 * longer matched produces no order at all, and the page polled for one until
 * it gave up and told them the order was "still being finalized", when the
 * money had already been sent back.
 */
export type CardPaymentOutcome =
  | {
      outcome: "order_placed";
      /**
       * Money already sent back for consignments that will not ship — a seller
       * whose goods sold out, or who called theirs off, while the shopper paid.
       * Absent when nothing was dropped.
       */
      refundedAmount?: number;
    }
  | {
      outcome: "order_cancelled";
      /** Cancelled because the goods sold out between checkout and capture. */
      soldOut: boolean;
      /** False when the refund could not be sent and an admin was told to. */
      refunded: boolean;
      refundedAmount: number;
    }
  | {
      outcome: "payment_returned";
      /** False when the refund could not be sent and an admin was told to. */
      refunded: boolean;
    };

export type CardOutcomeOrder = {
  status?: string | null;
  refundedTotal?: number | null;
  cancelReason?: string | null;
  subOrders?: Array<{ status?: string | null }> | null;
};

/** The fields `describeCardOrderOutcome` reads, as a Mongoose projection. */
export const CARD_OUTCOME_ORDER_FIELDS =
  "_id orderNumber status refundedTotal cancelReason subOrders.status";

export function describeCardOrderOutcome(
  order: CardOutcomeOrder,
): CardPaymentOutcome {
  const refundedAmount = roundMoney(Math.max(0, Number(order.refundedTotal || 0)));

  if (order.status === ORDER_STATUS.CANCELLED) {
    return {
      outcome: "order_cancelled",
      soldOut: order.cancelReason === SOLD_OUT_AFTER_CAPTURE_CANCEL_REASON,
      refunded: refundedAmount > 0,
      refundedAmount,
    };
  }

  // Only a refund that follows a dropped consignment is news for this page. A
  // partial refund an admin issued later on a live order is not "some items
  // were unavailable", and the page would be wrong to say so.
  const droppedConsignment = (order.subOrders || []).some(
    (sub) => sub?.status === ORDER_STATUS.CANCELLED,
  );
  return droppedConsignment && refundedAmount > 0
    ? { outcome: "order_placed", refundedAmount }
    : { outcome: "order_placed" };
}

export function describeReturnedCardPayment(
  rejection: StripePaymentRejection,
): CardPaymentOutcome {
  return { outcome: "payment_returned", refunded: rejection.refunded };
}
