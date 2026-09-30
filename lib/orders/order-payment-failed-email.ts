import "server-only";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { sendEmail } from "@/lib/email/email";
import { escapeHtml } from "@/lib/email/escape-html";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { formatCurrency } from "@/lib/intl/money";
import { orderPayLinkUrl } from "@/lib/payments/preorder-balance-link";
import { getOrderPayAmountDue, isOrderPayable } from "@/lib/payments/order-pay";
import { orderContactEmail } from "@/lib/orders/order-contact-email";

/**
 * "Your payment did not go through — here is how to pay."
 *
 * The email Shopify sends when a pending payment fails, and the reason the pay
 * link exists at all. Without it the shopper's side of a failed mobile-money
 * push is silence: the order sits in their history saying "payment pending"
 * for ever, and the first they hear of it is when the goods do not arrive.
 *
 * Transactional, not marketing: it is about an order they placed, so it goes
 * out whatever their newsletter preference is. An unsubscribe here would be
 * unsubscribing from being told about their own money.
 *
 * Sent once per order, held by the outbox's own dedupe key — a sweep that runs
 * twice, or a reconciler and a sweep agreeing, must not tell the same shopper
 * the same news twice.
 */
export async function sendOrderPaymentFailedEmail(params: {
  orderId: unknown;
  locale?: string;
  /**
   * False for a send a person asked for: "they say it never arrived" is a
   * reason to send the same news twice, and the automatic dedupe would
   * silently refuse.
   */
  dedupe?: boolean;
  /**
   * The store's settings, when the caller already has them — the recovery
   * email's sender takes the same. Read from the database otherwise.
   */
  settings?: Awaited<ReturnType<typeof getSettings>>;
}): Promise<boolean> {
  try {
    const order = await Order.findById(params.orderId)
      .select(
        "orderNumber status paymentStatus paymentMethod channel currency total preorderOutstandingAmount storeCredit customerId guestEmail customerLocale exchangeOf",
      )
      .lean<{
        _id: unknown;
        orderNumber?: string;
        currency?: string;
        paymentMethod?: string;
        customerId?: unknown;
        guestEmail?: string;
        customerLocale?: string;
        storeCredit?: { applied?: number | null; state?: string | null } | null;
        exchangeOf?: { returnNumber?: string; undoneAt?: Date | null } | null;
      } | null>();
    if (!order) return false;

    // Nothing is asked for on an order that no longer owes anything: a
    // payment that landed between the probe and this call, or an order
    // cancelled in the meantime.
    if (!isOrderPayable(order) || getOrderPayAmountDue(order) <= 0) return false;

    // A guest's own address, or a signed-in shopper's account one — see
    // `orderContactEmail` for why the order alone was not enough.
    const to = await orderContactEmail(order);
    if (!to) return false;

    const settings = params.settings ?? (await getSettings());
    const locale = params.locale || order.customerLocale || "en";
    const payUrl = orderPayLinkUrl(String(order._id), locale);
    // No signing secret means no link, and an email that says "pay now" with
    // nowhere to pay is worse than no email.
    if (!payUrl) return false;

    const storeName =
      settings.general?.storeName ||
      process.env.NEXT_PUBLIC_APP_NAME ||
      DEFAULT_STORE_NAME;
    const currency = String(order.currency || settings.general?.defaultCurrency || "USD");
    const amount = formatCurrency(getOrderPayAmountDue(order), currency);
    // The exchange a return became (R7): the return paid for most of it, and
    // this is the difference — never news of a failed payment.
    const exchangeFor =
      order.exchangeOf?.returnNumber && !order.exchangeOf.undoneAt
        ? order.exchangeOf.returnNumber
        : null;

    // An order the merchant raised themselves (an invoice, a bank transfer)
    // was never attempted, so "we could not collect the payment" would be
    // news of a failure that never happened.
    const neverAttempted = ["manual", "manual_pending", "bank_transfer"].includes(
      String(order.paymentMethod || "").toLowerCase(),
    );
    // No gateway reason in the sentence: what reaches here is the expiry
    // sweep's own vocabulary ("no_reference", "reconciler_closed"), which
    // means nothing to a shopper and is not theirs to act on.
    const orderNumber = escapeHtml(order.orderNumber);
    const opening = exchangeFor
      ? `Order <strong>#${orderNumber}</strong> is the exchange for your return ${escapeHtml(exchangeFor)}. Your return covered ${escapeHtml(formatCurrency(Math.max(0, Number(order.storeCredit?.applied) || 0), currency))} of it.`
      : neverAttempted
        ? `Order <strong>#${orderNumber}</strong> is waiting to be paid for.`
        : `We could not collect the payment for order <strong>#${orderNumber}</strong>.`;
    const middle = exchangeFor
      ? `Use the link below to pay the remaining ${escapeHtml(amount)} and we will send your exchange on its way.`
      : `Nothing has been charged, and your order is still here — the items, the prices and the delivery address are exactly as you left them. Use the link below to pay ${escapeHtml(amount)} and we will get it on its way.`;

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
        <h2 style="margin:0 0 12px">${escapeHtml(storeName)}</h2>
        <p>${opening}</p>
        <p>${middle}</p>
        <p><a href="${escapeHtml(payUrl)}" style="display:inline-block;background:#111827;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none">Pay for order #${orderNumber}</a></p>
        <p style="color:#6b7280;font-size:13px">This link works for seven days. After that, ask us for a new one — the order is not lost.</p>
      </div>
    `;

    return await sendEmail({
      to,
      subject: exchangeFor
        ? `Pay the difference for your exchange, order #${order.orderNumber}`
        : neverAttempted
          ? `Payment for order #${order.orderNumber}`
          : `Payment needed for order #${order.orderNumber}`,
      html,
      settings,
      // The shopper's own order, so it goes out regardless of marketing
      // consent — and is never suppressed as a campaign would be.
      category: "transactional",
      ...(params.dedupe === false
        ? {}
        : { dedupeKey: `order-payment-failed:${String(order._id)}` }),
    });
  } catch (error) {
    // Never throws into a sweep: a failed email must not stop the order being
    // written off, nor the rest of the batch being processed.
    console.error("Failed to send an order payment-failed email:", error);
    return false;
  }
}
