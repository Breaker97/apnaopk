import { PAYMENT_STATUS } from "@/config/app.config";

/**
 * Orders whose payment is still moving, and which nobody may touch until it
 * settles.
 *
 * Mobile money is asked for asynchronously: the request is accepted, a PIN
 * prompt goes to the payer's phone, and the answer arrives minutes — sometimes
 * hours — later, through a callback, a status poll, or the reconcile sweep.
 * For that whole window the order is real, unpaid, and about to become one of
 * two very different things.
 *
 * Editing it then is how a store loses money. Cancel it and restock it while
 * the payer is typing their PIN, and the payment lands on a cancelled order:
 * `finalizeCapturedOrder` refunds a late payment automatically for the
 * gateways that can, but **ioTec, MTN and Orange have no refund API at all**
 * (`lib/payments/finalize-order.ts:514`) — it records the refund, tells the
 * admins, and a person has to send the money back by hand. Marking it paid is
 * the mirror image: the goods go out on a payment that then fails.
 *
 * So the order is held until the payment resolves. `paid` opens everything.
 * `expired` — written by the expiry sweep only once the gateway has confirmed
 * no money arrived — opens it too, because there is then nothing to arrive.
 *
 * Shopify locks a pending payment exactly this way: an order awaiting an
 * asynchronous provider cannot be edited, cancelled, restocked or captured.
 *
 * **Not the card and redirect gateways.** A shopper who never came back from
 * PayPal or Razorpay leaves an order the store may well want to cancel, and
 * every one of those gateways can refund a late payment on its own. The
 * expiry sweep tidies them anyway.
 *
 * **Not cash on delivery**, which is unpaid by definition and holds no money
 * anywhere, and **not a till sale**, which changed hands at the counter.
 *
 * Deliberately free of `server-only` and of any import beyond the config
 * enums, exactly as the payment-status and custody modules are: the rule is
 * asserted in tests and read by routes, by the vendor area and by the shared
 * customer cancel alike.
 */

/**
 * The gateways that take money by pushing a prompt to the payer and answering
 * later. An allowlist, so a gateway added without thinking about this rule is
 * simply not locked rather than silently locked forever.
 */
export const ASYNC_PUSH_PAYMENT_METHODS = [
  "iotec",
  "mtn_momo",
  "orange_money",
] as const;

type PendingPaymentLockOrder = {
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  channel?: string | null;
};

const LOCK_MESSAGE =
  "This order's payment is still being processed by the mobile money provider. " +
  "It cannot be edited, cancelled or marked as paid until the payment settles — " +
  "the money can still arrive, and this provider cannot send it back automatically. " +
  "The payment is checked again every few minutes.";

/**
 * Why this order cannot be changed yet, or null when it can.
 *
 * A reason rather than a boolean, so every caller refuses in the same words —
 * the shape `getFulfillmentPaymentBlock` already uses for its own gate.
 */
export function getPendingPaymentLock(
  order: PendingPaymentLockOrder,
): string | null {
  if (String(order.channel || "").toLowerCase() === "pos") return null;

  const method = String(order.paymentMethod || "").trim().toLowerCase();
  if (!(ASYNC_PUSH_PAYMENT_METHODS as readonly string[]).includes(method)) {
    return null;
  }

  const paymentStatus = String(order.paymentStatus || PAYMENT_STATUS.PENDING);
  if (paymentStatus !== PAYMENT_STATUS.PENDING) return null;

  return LOCK_MESSAGE;
}
