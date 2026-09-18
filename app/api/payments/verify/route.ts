import { NextRequest, NextResponse } from "next/server";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  STRIPE_FEE_EXPAND,
} from "@/lib/payments/stripe";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import { Order } from "@/models";
import { connectDB } from "@/lib/db";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { handleApiError } from "@/lib/api/errors";
import { getSettings } from "@/models/settings.model";
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

type VerifiedOrder = {
  orderId: string;
  orderNumber: string;
  outcome: CardPaymentOutcome;
};

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

function verificationResponse(
  status: string,
  order: VerifiedOrder | null,
  returned?: CardPaymentOutcome,
) {
  if (!order) {
    return successResponse({ status, orderCreated: false, ...(returned ?? {}) });
  }
  return successResponse({
    status,
    orderCreated: true,
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    ...order.outcome,
  });
}

/**
 * GET /api/payments/verify
 * Verify checkout session and return order details
 *
 * The success page polls this while the shopper waits, so it asks Stripe once
 * per call: the order lookup runs alongside the retrieve (it does not need
 * Stripe's answer, only the response does), and the intent comes back with its
 * fee expanded so creating the order needs no second Stripe call.
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("session_id");
    const paymentIntentId = request.nextUrl.searchParams.get("payment_intent_id");

    if (!sessionId && !paymentIntentId) {
      return NextResponse.json(
        { success: false, message: "Session ID or Payment Intent ID required" },
        { status: 400 }
      );
    }

    await connectDB();
    const settings = await getSettings();
    const stripeSettings = settings.payment?.stripe;
    if (!stripeSettings?.enabled) {
      return NextResponse.json(
        { success: false, message: "Stripe is disabled" },
        { status: 400 }
      );
    }
    const stripeSecretKey = resolveStripeCredentials(stripeSettings).secretKey;
    if (!isStripeSecretKeyConfigured(stripeSecretKey)) {
      return NextResponse.json(
        { success: false, message: "Stripe is not configured" },
        { status: 500 }
      );
    }

    const stripe = getStripeForSecretKey(stripeSecretKey);

    if (paymentIntentId) {
      const [intent, existingOrder] = await Promise.all([
        stripe.paymentIntents.retrieve(paymentIntentId, {
          expand: [STRIPE_FEE_EXPAND],
        }),
        findStripeOrder({ stripePaymentIntentId: paymentIntentId }),
      ]);
      if (!intent) return notFoundResponse("Payment intent");

      // Fallback: if the payment has succeeded but the webhook hasn't
      // created the order (e.g. localhost without Stripe CLI, or a
      // misconfigured/unreachable webhook in production), finalize it
      // here. This is idempotent and safe to run alongside the webhook.
      if (!existingOrder && intent.status === "succeeded") {
        const { order, returned } = await finalizedOutcome(
          await finalizeStripePaymentIntentOrder(intent, settings),
        );
        return verificationResponse(intent.status, order, returned);
      }

      return verificationResponse(intent.status, existingOrder);
    }

    const [session, existingOrder] = await Promise.all([
      stripe.checkout.sessions.retrieve(sessionId as string, {
        expand: [`payment_intent.${STRIPE_FEE_EXPAND}`],
      }),
      findStripeOrder({ stripeSessionId: sessionId as string }),
    ]);
    if (!session) {
      return notFoundResponse("Session");
    }

    if (
      !existingOrder &&
      (session.payment_status === "paid" ||
        session.payment_status === "no_payment_required")
    ) {
      const { order, returned } = await finalizedOutcome(
        await finalizeStripeCheckoutSessionOrder(session, settings),
      );
      return verificationResponse(session.payment_status, order, returned);
    }

    return verificationResponse(session.payment_status, existingOrder);
  } catch (error) {
    return handleApiError(error);
  }
}
