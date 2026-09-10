import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import {
  type RazorpayPayment,
  verifyRazorpayWebhookSignature,
} from "@/lib/payments/razorpay";
import { finalizeRazorpayOrder } from "@/lib/payments/razorpay-orders";
import {
  readRazorpayRefund,
  reconcileGatewayRefundReading,
  reverseFailedGatewayRefund,
} from "@/lib/orders/order-refund-sync";
import {
  findPlatformPaymentByRazorpayOrderId,
  verifyPlatformPayment,
} from "@/lib/payments/platform-payments";

type RazorpayWebhookPayload = {
  event?: string;
  payload?: {
    payment?: {
      entity?: RazorpayPayment;
    };
    order?: {
      entity?: {
        id?: string;
      };
    };
    refund?: {
      entity?: {
        id?: string;
        status?: string;
        amount?: number;
        currency?: string;
        payment_id?: string;
      };
    };
  };
};

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing Razorpay signature" },
      { status: 400 },
    );
  }

  await connectDB();
  const settings = await getSettings();
  const webhookSecret =
    settings.payment?.razorpay?.webhookSecret ||
    process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("Missing RAZORPAY_WEBHOOK_SECRET");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  const isValidSignature = verifyRazorpayWebhookSignature({
    body,
    signature,
    webhookSecret,
  });

  if (!isValidSignature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: RazorpayWebhookPayload;
  try {
    event = JSON.parse(body) as RazorpayWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // A refund issued from the Razorpay dashboard, or one Storify raised that
  // failed on its way back. Neither reached the books before this, so the
  // order stayed fully paid and the vendor was still paid out for a sale the
  // shopper had already been refunded.
  if (event.event?.startsWith("refund.")) {
    const refund = event.payload?.refund?.entity;
    if (refund?.id) {
      if (event.event === "refund.failed") {
        await reverseFailedGatewayRefund(refund.id);
      } else {
        await reconcileGatewayRefundReading(readRazorpayRefund(refund));
      }
    }
    return NextResponse.json({ received: true });
  }

  if (event.event === "payment.captured" || event.event === "order.paid") {
    const payment = event.payload?.payment?.entity;
    const razorpayOrderId =
      payment?.order_id || event.payload?.order?.entity?.id;

    if (payment && razorpayOrderId) {
      // Vendor→platform payments (boosts, subscriptions) share this webhook.
      // Razorpay's payload only carries the order id, so the dispatch key is
      // the PlatformPayment's stored razorpayOrderId; the verify path
      // re-fetches the authoritative payment before finalizing.
      const platformPayment =
        await findPlatformPaymentByRazorpayOrderId(razorpayOrderId);
      if (platformPayment) {
        await verifyPlatformPayment(platformPayment, settings, {
          razorpayPaymentId: payment.id,
          // This route verified x-razorpay-signature on the raw body above.
          fromVerifiedWebhook: true,
        });
      } else {
        await finalizeRazorpayOrder({
          razorpayOrderId,
          payment,
          settings,
          customerEmail: payment.email || undefined,
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}
