import { Order } from "@/models";
import { PAYMENT_STATUS } from "@/config/app.config";
import { getNextOnlineOrderNumber } from "@/lib/orders/order-number";
import { bindOffersToOrder } from "@/lib/quotes/quote-offer";
import { PLATFORM_GATEWAY_PAYMENT_METHODS } from "@/lib/payments/payment-custody";

/**
 * Turn a finished order document into an order.
 *
 * The checkout route builds that document — every line, consignment, total,
 * address and pre-order term, priced at the moment the shopper pressed pay —
 * and until now went straight on to write it. Splitting the write out is what
 * lets the same document be **stored on a checkout attempt** while the shopper
 * is away at a gateway, and turned into an order only once the money has
 * actually arrived (`createOrderFromAttempt`). Two callers, one definition of
 * what placing an order does.
 *
 * Everything here reads from the document itself rather than being passed
 * alongside it, which is the point: an order promoted from an attempt days
 * later has no checkout route around it to ask.
 *
 * The two side effects are each best-effort. Neither may fail the order: the
 * money is either taken or committed by the time this runs, and an order whose
 * quote offers were not closed, or whose guest profile was not written, is a
 * paperwork gap, while an order that failed to save is a lost sale.
 */

/** The parts of an order document this module reads. */
export type OrderDocumentLike = Record<string, unknown> & {
  guestEmail?: string;
  paymentMethod?: string;
  shippingAddress?: { fullName?: string } | null;
  items?: Array<{ quoteId?: unknown }> | null;
};

export async function persistOrderFromDocument(
  document: OrderDocumentLike,
  options: {
    /** Store-configured ORD prefix. */
    orderPrefix?: string;
    /** Set when the order is being promoted from a checkout attempt. */
    checkoutAttemptId?: unknown;
    /**
     * Fields the gateway's answer supplies, which the document written before
     * the payment could not know: `paymentStatus`, `paidAt`, the capture ids.
     */
    overrides?: Record<string, unknown>;
  } = {},
) {
  // Burned here and nowhere earlier: an ORD number spent on a checkout nobody
  // paid for is a gap in the store's own sequence.
  const orderNumber = await getNextOnlineOrderNumber(options.orderPrefix);

  const order = await Order.create({
    ...document,
    ...(options.checkoutAttemptId
      ? { checkoutAttemptId: options.checkoutAttemptId }
      : {}),
    ...(options.overrides || {}),
    orderNumber,
  });

  // Spend the quote offers this order was placed against, so the same
  // negotiated price cannot be taken twice — but only once the order is an
  // obligation. A gateway order written before the shopper leaves for the
  // gateway is not one yet: bound here, a shopper who walked away left the
  // price stuck on an unpaid order hidden from every list, and their next
  // checkout was refused. Those are bound when the money lands
  // (settleCapturedOrder), the way a Stripe order is. The quote is marked *won*
  // here only for cash on delivery, which has no capture to wait for.
  const paymentMethod = String(document.paymentMethod || "").toLowerCase();
  const paymentStatus =
    (options.overrides?.paymentStatus as string | undefined) ??
    (document.paymentStatus as string | undefined);
  const awaitingGateway =
    (PLATFORM_GATEWAY_PAYMENT_METHODS as readonly string[]).includes(
      paymentMethod,
    ) && (!paymentStatus || paymentStatus === PAYMENT_STATUS.PENDING);
  if (!awaitingGateway) {
    await bindOffersToOrder(
      (document.items || [])
        .map((item) => (item.quoteId ? String(item.quoteId) : ""))
        .filter(Boolean),
      String(order._id),
      { won: paymentMethod === "cod" },
    ).catch((err) =>
      console.error("Failed to close quote offers on order:", err),
    );
  }

  // Every checkout leaves a customer record behind, the Shopify way: a guest
  // order upserts an email-keyed guest row at the moment the order exists — not
  // when payment lands — so COD guests appear in the admin list immediately.
  // Best-effort: the stats refresh on payment re-upserts the same row, so a
  // miss here heals itself.
  if (document.guestEmail) {
    const { upsertGuestCustomerProfile } = await import(
      "@/lib/customers/customer"
    );
    await upsertGuestCustomerProfile({
      email: document.guestEmail,
      name: document.shippingAddress?.fullName,
    }).catch((err) =>
      console.error("Failed to upsert guest customer profile:", err),
    );
  }

  return order;
}
