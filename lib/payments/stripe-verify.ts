import "server-only";

import type Stripe from "stripe";
import { STRIPE_FEE_EXPAND } from "@/lib/payments/stripe";
import { Order } from "@/models";
import type { getSettings } from "@/models/settings.model";
import {
  finalizeStripeCheckoutSessionOrder,
  finalizeStripePaymentIntentOrder,
} from "@/lib/payments/stripe-orders";
import {
  CARD_OUTCOME_ORDER_FIELDS,
  describeCardOrderOutcome,
  describeReturnedCardPayment,
  type CardOutcomeOrder,
  type CardPaymentOutcome,
} from "@/lib/payments/card-payment-outcome";

/**
 * What a Stripe payment came to, asked on the shopper's behalf: the order it
 * produced, or — when the webhook has not written one yet and Stripe says the
 * money is in — the order written here. Finalizing is idempotent and safe
 * alongside the webhook (lib/payments/stripe-orders.ts).
 *
 * Moved here from GET /api/payments/verify, which the success page polls; the
 * shopper app's POST /checkout/stripe/confirm asks the same of its
 * PaymentIntent.
 */

export type VerifiedOrder = {
  orderId: string;
  orderNumber: string;
  outcome: CardPaymentOutcome;
};

export type StripeVerification = {
  /** Stripe's own word: the intent's status, or the session's payment status. */
  status: string;
  order: VerifiedOrder | null;
  /** Why a payment that produced no order was sent back, when it was. */
  returned?: CardPaymentOutcome;
};

type SettingsDocument = Awaited<ReturnType<typeof getSettings>>;

type OutcomeOrderRow = CardOutcomeOrder & { _id: unknown; orderNumber: string };

type FinalizeResult = Awaited<
  ReturnType<typeof finalizeStripePaymentIntentOrder>
>;

function verifiedOrderOf(row: OutcomeOrderRow | null): VerifiedOrder | null {
  return row
    ? {
        orderId: String(row._id),
        orderNumber: row.orderNumber,
        outcome: describeCardOrderOutcome(row),
      }
    : null;
}

/** The order a Stripe payment already produced, by its idempotency column. */
async function findStripeOrder(
  filter: { stripePaymentIntentId: string } | { stripeSessionId: string },
): Promise<VerifiedOrder | null> {
  return verifiedOrderOf(
    await Order.findOne(filter)
      .select(CARD_OUTCOME_ORDER_FIELDS)
      .lean<OutcomeOrderRow | null>(),
  );
}

/**
 * What finalizing a payment left behind. The order is read back rather than
 * taken as placed: settling cancels the order it has just written when the
 * goods sold out while the card was confirming, and that order must not be
 * reported as a success. No order at all is either a payment that was sent
 * back, or one still waiting on something this call cannot fix.
 */
async function finalizedOutcome(result: FinalizeResult): Promise<{
  order: VerifiedOrder | null;
  returned?: CardPaymentOutcome;
}> {
  if (result.orderId && result.orderNumber) {
    const row = await Order.findById(result.orderId)
      .select(CARD_OUTCOME_ORDER_FIELDS)
      .lean<OutcomeOrderRow | null>();
    return {
      order: verifiedOrderOf(row) ?? {
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        outcome: { outcome: "order_placed" },
      },
    };
  }
  return {
    order: null,
    returned: result.rejected
      ? describeReturnedCardPayment(result.rejected)
      : undefined,
  };
}

/**
 * A PaymentIntent's outcome, or null when Stripe has no such intent.
 *
 * Asks Stripe once: the order lookup runs alongside the retrieve (it does not
 * need Stripe's answer, only the response does), and the intent comes back
 * with its fee expanded so creating the order needs no second Stripe call.
 *
 * `assertOwner` sees the intent before anything is finalized, and throws to
 * refuse a caller it does not belong to.
 */
export async function verifyStripePaymentIntent(
  stripe: Stripe,
  paymentIntentId: string,
  settings: SettingsDocument,
  options: { assertOwner?: (intent: Stripe.PaymentIntent) => void | Promise<void> } = {},
): Promise<StripeVerification | null> {
  const [intent, existingOrder] = await Promise.all([
    stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: [STRIPE_FEE_EXPAND],
    }),
    findStripeOrder({ stripePaymentIntentId: paymentIntentId }),
  ]);
  if (!intent) return null;
  await options.assertOwner?.(intent);

  // Fallback: if the payment has succeeded but the webhook hasn't
  // created the order (e.g. localhost without Stripe CLI, or a
  // misconfigured/unreachable webhook in production), finalize it
  // here. This is idempotent and safe to run alongside the webhook.
  if (!existingOrder && intent.status === "succeeded") {
    const { order, returned } = await finalizedOutcome(
      await finalizeStripePaymentIntentOrder(intent, settings),
    );
    return { status: intent.status, order, returned };
  }

  return { status: intent.status, order: existingOrder };
}

/** A hosted Checkout Session's outcome, or null when Stripe has no such session. */
export async function verifyStripeCheckoutSession(
  stripe: Stripe,
  sessionId: string,
  settings: SettingsDocument,
): Promise<StripeVerification | null> {
  const [session, existingOrder] = await Promise.all([
    stripe.checkout.sessions.retrieve(sessionId, {
      expand: [`payment_intent.${STRIPE_FEE_EXPAND}`],
    }),
    findStripeOrder({ stripeSessionId: sessionId }),
  ]);
  if (!session) return null;

  if (
    !existingOrder &&
    (session.payment_status === "paid" ||
      session.payment_status === "no_payment_required")
  ) {
    const { order, returned } = await finalizedOutcome(
      await finalizeStripeCheckoutSessionOrder(session, settings),
    );
    return { status: session.payment_status, order, returned };
  }

  return { status: session.payment_status, order: existingOrder };
}
