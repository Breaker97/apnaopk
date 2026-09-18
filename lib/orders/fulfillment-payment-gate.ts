import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import {
  getPreorderBalanceDue,
  isSubOrderPaid,
  resolveSubOrderPaymentStatus,
  type SubOrderPaymentShape,
} from "@/lib/orders/order-payment-status";
import { PLATFORM_GATEWAY_PAYMENT_METHODS } from "@/lib/payments/payment-custody";

/**
 * Whether a consignment may go to the warehouse yet — asked before anyone
 * packs it, books a label for it, or hands it to a courier.
 *
 * A gateway order is written `pending` before the shopper reaches PayPal,
 * Razorpay, Paystack or Pesapal, and nothing tidies away the ones they walk
 * out of. The vendor sees that row like any other, and the workflow alone let
 * them move it to processing, buy a label and ship goods nobody paid for. The
 * automatic dispatcher already refused (`lib/shipping/automation.ts`); the
 * hands-on paths did not. This is that refusal, stated once for all of them.
 *
 * What it does NOT block, deliberately:
 *
 *  - **cash on delivery** — unpaid until the door by definition; the courier
 *    or the vendor collects it there;
 *  - **money the merchant takes themselves** (`manual`, `manual_pending`, a
 *    till sale) — nothing on the platform could ever confirm it, so the
 *    merchant who holds the money is the one who decides.
 *
 * Deliberately free of `server-only`, like the payment-status module it builds
 * on, so the rule is asserted in tests and shared by routes and the carrier
 * layer alike.
 */

/** The statuses that commit goods to a shopper. Cancelling is never gated. */
const FULFILLMENT_STATUSES: ReadonlySet<string> = new Set([
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.DELIVERED,
]);

const NOT_PAID_MESSAGE =
  "The customer's payment has not been received for this order, so it cannot be fulfilled yet.";

const REFUNDED_MESSAGE =
  "This order's payment has been refunded in full — by the store or by a chargeback — so it cannot be fulfilled.";

export type FulfillmentGateOrder = {
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string | null;
  channel?: string | null;
  hasPreorder?: boolean | null;
  preorderOutstandingAmount?: number | null;
  preorderBalancePaidAt?: Date | string | null;
  total?: number | null;
  subOrders?: Array<
    SubOrderPaymentShape & {
      items?: Array<{ preorderOutstandingAmount?: number | null }> | null;
    }
  > | null;
};

/** Whether moving a consignment to `target` hands goods towards the shopper. */
export function isFulfillmentTransition(target: string | null | undefined): boolean {
  return FULFILLMENT_STATUSES.has(String(target || ""));
}

/**
 * Why this consignment cannot be fulfilled yet, or null when it can.
 *
 * A reason rather than a boolean so every caller refuses in the same words.
 */
export function getFulfillmentPaymentBlock(
  order: FulfillmentGateOrder,
  subOrder: SubOrderPaymentShape | null | undefined,
): string | null {
  // A till sale changed hands at the counter.
  if (String(order.channel || "").toLowerCase() === "pos") return null;

  const method = String(order.paymentMethod || "").trim().toLowerCase();
  const isGateway = (PLATFORM_GATEWAY_PAYMENT_METHODS as readonly string[]).includes(
    method,
  );
  const paymentStatus = resolveSubOrderPaymentStatus(order, subOrder);

  // Nothing captured at all — the abandoned-at-the-gateway case, deposit
  // pre-orders included, which is why it is asked before the balance.
  if (isGateway && paymentStatus === PAYMENT_STATUS.PENDING) {
    return NOT_PAID_MESSAGE;
  }

  // A pre-order whose balance has not arrived is not released, however it was
  // paid for. Only the vendor pre-order screen asked this; moving the same
  // order from the ordinary orders screen skipped the question entirely.
  //
  // The same "still owed" every release path already asks
  // (`getPreorderBalanceDue`), so this gate and the pre-order screens can never
  // disagree about one order.
  if (order.hasPreorder && getPreorderBalanceDue(order) > 0) {
    return "The customer has not paid the rest of this pre-order yet, so it cannot be fulfilled.";
  }

  if (!isGateway) return null;

  if (isSubOrderPaid(order, subOrder)) return null;

  // A deposit pre-order whose owing consignment was called off can sit on
  // `partially_paid` with nothing left to collect — the check above has
  // already established that nothing is still to come.
  if (order.hasPreorder && paymentStatus === PAYMENT_STATUS.PARTIALLY_PAID) {
    return null;
  }

  // Refunded in full — by the store, or taken back by a chargeback — or a
  // status nothing recognises: nothing is here to ship against. A refund says
  // so, because "not received" sends someone looking for a payment that did
  // arrive.
  if (paymentStatus === PAYMENT_STATUS.REFUNDED) return REFUNDED_MESSAGE;
  return NOT_PAID_MESSAGE;
}
