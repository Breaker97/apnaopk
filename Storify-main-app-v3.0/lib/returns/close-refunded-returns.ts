import { ReturnRequest } from "@/models";
import {
  NOTHING_REFUNDED_ON_RETURN,
  OPEN_RETURN_STATUSES,
  REFUND_IN_MOTION_STATUSES,
  RETURN_REFUND_STATUS,
  RETURN_STATUS,
} from "@/lib/returns/returns";

/**
 * Close the returns a refund on the order itself has just paid for.
 *
 * Called once a refund leaves nothing of the order's goods unrefunded — the
 * Full refund of an order with a return still open on it. The store's
 * decision (2026-09-27, Shopify's too): that refund pays for the return's
 * goods, and the return closes with it. Left open, the return went on
 * offering its whole value on every screen, and the delivery a dispatched
 * order keeps back was the money a second refund of the same goods would have
 * come out of.
 *
 * A return whose own refund is moving — sent and not yet settled, or recorded
 * by hand and still to be paid — is left alone: closing it would hide money in
 * flight. The refund caps stop it paying more than the order has left either
 * way. A return part-refunded through its own route closes too; the order's
 * refund covered the rest.
 *
 * The parcel still comes back, and "Put back in stock" works on a closed
 * return, so nothing about the goods is decided here.
 */
export async function closeReturnsRefundedByOrder(params: {
  orderId: unknown;
  /** The refund row that paid for them. */
  transactionId?: unknown;
  at?: Date;
}): Promise<number> {
  const at = params.at ?? new Date();
  const open = {
    orderId: params.orderId,
    status: { $in: OPEN_RETURN_STATUSES },
    refundStatus: { $nin: REFUND_IN_MOTION_STATUSES },
  };
  const closed = {
    status: RETURN_STATUS.CLOSED,
    closedAt: at,
    refundedByOrderAt: at,
    ...(params.transactionId
      ? { refundedByOrderTransactionId: params.transactionId }
      : {}),
  };

  const [untouched, partlyRefunded] = await Promise.all([
    // Nothing went through the return itself: the refund it was waiting for
    // is no longer needed, and every screen that hides a refund nobody owes
    // stops offering one.
    ReturnRequest.updateMany(
      { ...open, ...NOTHING_REFUNDED_ON_RETURN },
      { $set: { ...closed, refundStatus: RETURN_REFUND_STATUS.NOT_REQUIRED } },
    ),
    // Part of it went through the return, and its refund status still says
    // how that part went.
    ReturnRequest.updateMany(
      { ...open, "actualRefund.amount": { $gt: 0 } },
      { $set: closed },
    ),
  ]);
  return (
    Number(untouched?.modifiedCount || 0) + Number(partlyRefunded?.modifiedCount || 0)
  );
}
