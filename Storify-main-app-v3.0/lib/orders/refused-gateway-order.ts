import { Order } from "@/models";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { recordChargeFailure } from "@/lib/payments/payment-transactions";
import { releaseAsyncPushInventory } from "@/lib/orders/async-push-inventory";
import { recordCheckoutPaymentEvent } from "@/lib/orders/abandoned-checkouts";

/**
 * Retire the order behind a payment request the gateway refused outright.
 *
 * The mobile-money paths write the order BEFORE asking the gateway for the
 * money, and that ordering is deliberate: ioTec has no refund API, so a
 * collection that starts with no order behind it is money nobody can give
 * back. (Writing an attempt row first, and the order only once the gateway
 * accepts, is what the checkout-attempt work is for; until then, first is the
 * safe side to be wrong on.)
 *
 * What that leaves is the other case — the gateway said **no** immediately: a
 * 4xx on the collection request, a payment session that could not be created.
 * Nothing was queued and no phone was prompted, so that order can never be
 * paid. It used to be marked `cancelled` and left there, which put a
 * cancellation in the store's books for a checkout that never happened, and
 * left no record of what the gateway had actually said.
 *
 * Now it is marked `cancelled` AND `expired`: cancelled because it is over,
 * `expired` because no money was ever taken, which is what keeps it out of
 * every list and every report (`placedOrderMatch`). Shopify's answer to the
 * same event is no order at all; this is as close as a row that already
 * exists can get.
 *
 * The refusal is also recorded twice over — once in the payment log and once
 * on the shopper's own checkout timeline — because "ioTec refused the request"
 * is exactly what a store worker needs when the shopper rings up about it.
 *
 * Never throws: every caller is already handling a failure and is about to
 * rethrow it to the shopper.
 */

/** The `cancelReason` these orders carry, so a report can tell them apart. */
const GATEWAY_REFUSED_CANCEL_REASON =
  "The payment provider refused the payment request, so no payment was ever started.";

export async function retireRefusedGatewayOrder(params: {
  orderId: unknown;
  orderNumber?: string;
  cartId?: unknown;
  paymentMethod: string;
  amount?: number;
  currency?: string;
  /** The gateway error, when the refusal came as one. */
  error?: unknown;
  /** A code for the refusal, when there is no error to read one from. */
  reason?: string;
}): Promise<void> {
  const message =
    params.error instanceof Error
      ? params.error.message
      : params.error
        ? String(params.error)
        : undefined;

  try {
    // Guarded on `pending`: if the payment somehow landed between the request
    // failing and this write, the order it landed on is not ours to retire.
    await Order.updateOne(
      { _id: params.orderId, paymentStatus: PAYMENT_STATUS.PENDING },
      {
        $set: {
          status: ORDER_STATUS.CANCELLED,
          paymentStatus: PAYMENT_STATUS.EXPIRED,
          cancelReason: GATEWAY_REFUSED_CANCEL_REASON,
          cancelledAt: new Date(),
          // Nothing is left to ask the gateway about, so the expiry sweep
          // should not spend a call on it.
          paymentReconcileClosedAt: new Date(),
        },
      },
    );
  } catch (error) {
    console.error(
      `Failed to retire order ${params.orderNumber || params.orderId} after ${params.paymentMethod} refused the request:`,
      error,
    );
  }

  // Goods this order took off the shelf when it was written — the mobile-money
  // paths hold stock from the moment the order exists. Claim-based, so an
  // order that held nothing is a no-op.
  await releaseAsyncPushInventory(params.orderId);

  await recordChargeFailure({
    provider: params.paymentMethod,
    paymentMethod: params.paymentMethod,
    amount: params.amount,
    currency: params.currency,
    failureCode: params.reason || "gateway_refused_request",
    gatewayMessage: message,
    // The shopper was at the checkout when this happened, not a webhook.
    source: "client",
    orderId: params.orderId,
    orderNumber: params.orderNumber,
    dedupeKey: `refused:${String(params.orderId)}`,
  });

  await recordCheckoutPaymentEvent({
    cartId: params.cartId,
    gateway: params.paymentMethod,
    status: "failed",
    message: message || params.reason || "The payment request was refused",
  });
}
