import { NextRequest, NextResponse } from "next/server";
import { getStripeForSecretKey, isStripeSecretKeyConfigured } from "@/lib/payments/stripe";
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

/**
 * GET /api/payments/verify
 * Verify checkout session and return order details
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
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (!intent) return notFoundResponse("Payment intent");

      let order = await Order.findOne({
        stripePaymentIntentId: paymentIntentId,
      }).lean();

      // Fallback: if the payment has succeeded but the webhook hasn't
      // created the order (e.g. localhost without Stripe CLI, or a
      // misconfigured/unreachable webhook in production), finalize it
      // here. This is idempotent and safe to run alongside the webhook.
      if (!order && intent.status === "succeeded") {
        const result = await finalizeStripePaymentIntentOrder(
          intent,
          settings,
        );
        if (result.orderId) {
          order = await Order.findById(result.orderId).lean();
        }
      }

      if (!order) {
        return successResponse({
          status: intent.status,
          orderCreated: false,
        });
      }

      return successResponse({
        status: intent.status,
        orderCreated: true,
        orderId: order._id,
        orderNumber: order.orderNumber,
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId as string);
    if (!session) {
      return notFoundResponse("Session");
    }

    let order = await Order.findOne({ stripeSessionId: sessionId }).lean();

    if (
      !order &&
      (session.payment_status === "paid" ||
        session.payment_status === "no_payment_required")
    ) {
      const result = await finalizeStripeCheckoutSessionOrder(
        session,
        settings,
      );
      if (result.orderId) {
        order = await Order.findById(result.orderId).lean();
      }
    }

    if (!order) {
      return successResponse({
        status: session.payment_status,
        orderCreated: false,
      });
    }

    return successResponse({
      status: session.payment_status,
      orderCreated: true,
      orderId: order._id,
      orderNumber: order.orderNumber,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
