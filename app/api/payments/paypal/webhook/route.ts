import { NextRequest, NextResponse } from "next/server";

import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { verifyPayPalWebhookSignature, type PayPalMode } from "@/lib/payments/paypal";
import {
  readPayPalRefund,
  reconcileGatewayRefundReading,
  reverseFailedGatewayRefund,
} from "@/lib/orders/order-refund-sync";

/**
 * POST /api/payments/paypal/webhook
 *
 * PayPal had no webhook at all, which meant a refund issued from the PayPal
 * dashboard reached Storify nowhere: no transaction row, no ledger entry, the
 * order still reading as fully paid, and the vendor still paid out for a sale
 * the shopper already had their money back for. A refund that PayPal later
 * cancelled was equally invisible in the other direction.
 *
 * Only refund events are handled here. Captures already arrive through the
 * client-side capture call, which is authoritative because it fetches the
 * order from PayPal itself; adding a second path for them would be two ways to
 * finalize one payment.
 */

/** The refund resource, as PayPal delivers it. */
type PayPalRefundResource = {
  id?: string;
  status?: string;
  amount?: { value?: string; currency_code?: string } | null;
  links?: Array<{ rel?: string; href?: string }> | null;
  capture_id?: string;
};

type PayPalWebhookEvent = {
  event_type?: string;
  resource?: PayPalRefundResource;
};

/** Events that say money went back, or stopped going back. */
const REFUND_EVENTS = new Set([
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.REFUND.COMPLETED",
]);
const REFUND_FAILURE_EVENTS = new Set([
  "PAYMENT.REFUND.FAILED",
  "PAYMENT.REFUND.CANCELLED",
]);

export async function POST(request: NextRequest) {
  const body = await request.text();

  await connectDB();
  const settings = await getSettings();
  const paypal = settings.payment?.paypal;

  if (!paypal?.enabled || !paypal.clientId || !paypal.clientSecret) {
    return NextResponse.json({ error: "PayPal is not configured" }, { status: 400 });
  }
  // Without a webhook id there is nothing to verify against, and an unverified
  // body must never be allowed to move money. Refusing loudly is what gets the
  // setting filled in; accepting quietly is what gets a store defrauded.
  if (!paypal.webhookId) {
    console.error("PayPal webhook received but no webhook ID is configured");
    return NextResponse.json(
      { error: "PayPal webhook ID is not configured" },
      { status: 400 },
    );
  }

  let event: PayPalWebhookEvent;
  try {
    event = JSON.parse(body) as PayPalWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const verified = await verifyPayPalWebhookSignature({
    creds: {
      clientId: paypal.clientId,
      clientSecret: paypal.clientSecret,
      mode: ((paypal.mode as PayPalMode) || "sandbox") as PayPalMode,
    },
    webhookId: paypal.webhookId,
    headers: {
      authAlgo: request.headers.get("paypal-auth-algo"),
      certUrl: request.headers.get("paypal-cert-url"),
      transmissionId: request.headers.get("paypal-transmission-id"),
      transmissionSig: request.headers.get("paypal-transmission-sig"),
      transmissionTime: request.headers.get("paypal-transmission-time"),
    },
    event,
  }).catch((error) => {
    // A verification round trip that fails is not a verification that passed.
    console.error("PayPal webhook verification failed:", error);
    return false;
  });

  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const eventType = String(event.event_type || "");
  const resource = event.resource;

  try {
    if (REFUND_FAILURE_EVENTS.has(eventType) && resource?.id) {
      await reverseFailedGatewayRefund(resource.id);
    } else if (REFUND_EVENTS.has(eventType) && resource) {
      const recorded = await reconcileGatewayRefundReading(
        readPayPalRefund(resource),
      );
      if (recorded > 0) {
        console.log(
          `Recorded ${recorded} gateway-issued PayPal refund(s) for ${resource.id}`,
        );
      }
    }
  } catch (error) {
    // 5xx so PayPal retries. A refund the books never learned about is exactly
    // the failure this route exists to stop, so losing one to a transient
    // database error would defeat the point of having it.
    console.error("Failed to process PayPal webhook:", error);
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
