import { NextResponse } from "next/server";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
} from "@/lib/payments/stripe";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { getSettings } from "@/models/settings.model";
import type { CardPaymentOutcome } from "@/lib/payments/card-payment-outcome";
import {
  verifyStripeCheckoutSession,
  verifyStripePaymentIntent,
  type VerifiedOrder,
} from "@/lib/payments/stripe-verify";

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
 *
 * Through `withApi` rather than a bare export, for the rate limit: this is the
 * one payment route a browser calls in a loop, it reaches Stripe's API on
 * every call, and it CREATES the order when the webhook has not. A lenient
 * preset, because a shopper watching the success page legitimately polls it
 * several times a minute; it is there to stop a script, not the shopper.
 *
 * Deliberately still open to anyone holding the id: a guest's success page has
 * no session to check against, and the ids are Stripe's own long random
 * strings. Scoping it properly belongs with the checkout-attempt work, where
 * the attempt is owned by a cart session.
 */
export const GET = withApi(
  { rateLimit: { action: "payments:verify", preset: "lenient" } },
  async ({ request }) => {
    const sessionId = request.nextUrl.searchParams.get("session_id");
    const paymentIntentId = request.nextUrl.searchParams.get("payment_intent_id");

    if (!sessionId && !paymentIntentId) {
      return NextResponse.json(
        { success: false, message: "Session ID or Payment Intent ID required" },
        { status: 400 }
      );
    }

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
      const verified = await verifyStripePaymentIntent(stripe, paymentIntentId, settings);
      if (!verified) return notFoundResponse("Payment intent");
      return verificationResponse(verified.status, verified.order, verified.returned);
    }

    const verified = await verifyStripeCheckoutSession(stripe, sessionId as string, settings);
    if (!verified) {
      return notFoundResponse("Session");
    }
    return verificationResponse(verified.status, verified.order, verified.returned);
  },
);
