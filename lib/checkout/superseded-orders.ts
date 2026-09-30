import { Cart, Order } from "@/models";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";

/**
 * The unpaid orders a checkout leaves behind once it is finished some other
 * way, and retiring them so none of them can be paid for a second time.
 *
 * Split out of `checkout-attempts.ts` so the expiry sweep can use it: that
 * module is `server-only`, and the sweep also runs from
 * `scripts/retire-stale-gateway-orders.ts`, where importing it throws.
 */

/**
 * The redirect gateways whose unpaid orders are reused and retired. The
 * mobile-money ones (ioTec, Orange Money, MTN MoMo) put a PIN prompt on the
 * payer's phone per attempt and ioTec has no refund API, so a pending one is
 * neither reused nor cancelled — only once it has been written off.
 */
export const REUSABLE_ATTEMPT_METHODS = [
  "razorpay",
  "paypal",
  "paystack",
  "pesapal",
] as const;
export type ReusableAttemptMethod = (typeof REUSABLE_ATTEMPT_METHODS)[number];

/** The reason a retired order carries, and how the pay page recognises one. */
export const SUPERSEDED_ATTEMPT_REASON = "Replaced by a newer checkout attempt";

/**
 * A redirect-gateway order still waiting for its payment. Only the gateways in
 * `REUSABLE_ATTEMPT_METHODS` are cancelled in this state.
 */
export const LIVE_ATTEMPT = {
  status: ORDER_STATUS.PENDING,
  paymentStatus: PAYMENT_STATUS.PENDING,
};

/**
 * An order the expiry sweep wrote off: its gateway said nothing was paid, so
 * its payment is `expired` — but the order itself stays open, because the
 * failure email offers the shopper a link to pay it. Once the checkout has been
 * paid for some other way, that link would collect for the same goods again,
 * so these are retired along with live attempts. Any gateway: nothing is in
 * flight on a written-off order, and a mobile-money one gave its stock back
 * when it expired.
 *
 * `preordered` as well as `pending`, because a pre-order checkout is written
 * in that state before anything is paid, and the sweep writes those off too.
 */
export const WRITTEN_OFF_ATTEMPT = {
  status: { $in: [ORDER_STATUS.PENDING, ORDER_STATUS.PREORDERED] },
  paymentStatus: PAYMENT_STATUS.EXPIRED,
};

/** What an order's payment is once its money has arrived. */
const PAID_PAYMENT_STATUSES: string[] = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.PARTIALLY_PAID,
  PAYMENT_STATUS.REFUNDED,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
];

/**
 * Cancel an unpaid attempt nobody will return to. Conditional on it still
 * being unpaid, so a payment that landed a moment ago is never undone — and a
 * payment that lands after it is refunded by the finalizer.
 */
export async function retireCheckoutAttempt(orderId: unknown): Promise<boolean> {
  const result = await Order.updateOne(
    { _id: orderId, $or: [LIVE_ATTEMPT, WRITTEN_OFF_ATTEMPT] },
    {
      $set: {
        status: ORDER_STATUS.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: SUPERSEDED_ATTEMPT_REASON,
        "subOrders.$[].status": ORDER_STATUS.CANCELLED,
      },
    },
  ).catch((err) => {
    console.error("Failed to retire a superseded checkout attempt:", err);
    return { modifiedCount: 0 };
  });
  return result.modifiedCount === 1;
}

/**
 * The cart became an order some other way — paid by card, cash on delivery,
 * pay later, one of the redirect gateways, or a pay link — so none of its
 * other unpaid orders will be paid, and none may be: each written-off one
 * still has a pay link in the shopper's inbox. Cancelled, except the order the
 * cart became.
 */
export async function retireCartCheckoutAttempts(
  cartId: unknown,
  exceptOrderId?: unknown,
): Promise<number> {
  if (!cartId) return 0;
  const attempts = await Order.find({
    checkoutCartId: cartId,
    ...(exceptOrderId ? { _id: { $ne: exceptOrderId } } : {}),
    $or: [
      { ...LIVE_ATTEMPT, paymentMethod: { $in: REUSABLE_ATTEMPT_METHODS } },
      WRITTEN_OFF_ATTEMPT,
    ],
  })
    .select("_id")
    .lean<Array<{ _id: unknown }>>();
  const retired = await Promise.all(
    attempts.map((attempt) => retireCheckoutAttempt(attempt._id)),
  );

  // And the same cart's checkout attempts, for the gateways already switched
  // over. Imported here rather than at the top: that module reaches the models
  // barrel, and this one is loaded by tests that stub the database.
  const { closeCartOpenAttempts } = await import(
    "@/lib/checkout/checkout-attempt-store"
  );
  const closed = await closeCartOpenAttempts(cartId).catch((err) => {
    console.error("Failed to close the cart's open checkout attempts:", err);
    return 0;
  });

  return retired.filter(Boolean).length + closed;
}

/**
 * Whether the checkout this order came from was finished some other way after
 * the order was written: by card, cash on delivery, another gateway, or a pay
 * link settling a sibling order.
 *
 * Asked by the expiry sweep before it writes an order off and emails a way to
 * pay. A mobile-money order cannot be retired while its push may still be
 * approved, so when the cart is bought by card in the meantime, the push
 * failing later is the first moment that order can be closed — and offering to
 * collect it then would sell the shopper the same goods twice.
 *
 * "After" matters: a cart is reused for later baskets, so a purchase it made
 * before this order began says nothing about this one.
 */
export async function wasSupersededByLaterPurchase(order: {
  _id: unknown;
  checkoutCartId?: unknown;
  createdAt?: Date | string | null;
}): Promise<boolean> {
  if (!order.checkoutCartId || !order.createdAt) return false;
  const began = new Date(order.createdAt);

  // Finished through the cart — a card, cash on delivery, a gateway's return
  // — which stamps the cart with the order it became.
  const cart = await Cart.findById(order.checkoutCartId)
    .select("orderId completedAt")
    .lean<{ orderId?: unknown; completedAt?: Date | string | null } | null>();
  if (
    cart?.orderId &&
    String(cart.orderId) !== String(order._id) &&
    cart.completedAt &&
    new Date(cart.completedAt).getTime() > began.getTime()
  ) {
    return true;
  }

  // Or a sibling paid through its pay link or a webhook, which settles without
  // the cart — found by the checkout it came from instead.
  const sibling = await Order.exists({
    checkoutCartId: order.checkoutCartId,
    _id: { $ne: order._id },
    paymentStatus: { $in: PAID_PAYMENT_STATUSES },
    paidAt: { $gt: began },
  });
  return Boolean(sibling);
}
