import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import {
  fromRazorpayAmountSubunits,
  type RazorpayPayment,
  verifyRazorpayWebhookSignature,
} from "@/lib/payments/razorpay";
import { finalizeRazorpayOrder } from "@/lib/payments/razorpay-orders";
import { ValidationError } from "@/lib/api/errors";
import {
  readRazorpayRefund,
  reconcileGatewayRefundReading,
  reverseFailedGatewayRefund,
} from "@/lib/orders/order-refund-sync";
import {
  findPlatformPaymentByRazorpayOrderId,
  verifyPlatformPayment,
} from "@/lib/payments/platform-payments";
import { syncRazorpayDisputeEvent } from "@/lib/payments/gateway-disputes";
import { resolveRazorpayCredentials } from "@/lib/settings/credentials";
import type { RazorpayDisputeLike } from "@/lib/orders/dispute-readings";

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
    dispute?: {
      entity?: RazorpayDisputeLike;
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

  // A chargeback. Razorpay takes the money only when the store loses (or
  // accepts), and gives it back if a later decision goes the store's way; the
  // other events carry a deadline an admin has to meet. Every one of them is
  // applied from the dispute as Razorpay has it now — see
  // `syncRazorpayDisputeEvent`.
  if (event.event?.startsWith("payment.dispute.")) {
    const dispute = event.payload?.dispute?.entity;
    if (dispute?.id) {
      try {
        await syncRazorpayDisputeEvent({ dispute, settings });
      } catch (error) {
        // 5xx so Razorpay retries: a chargeback the books never learned about
        // pays the vendor out on money the store no longer has.
        console.error("Failed to process Razorpay dispute webhook:", error);
        return NextResponse.json(
          { error: "Failed to process webhook" },
          { status: 500 },
        );
      }
    }
    return NextResponse.json({ received: true });
  }

  // A refund issued from the Razorpay dashboard, or one Storify raised that
  // failed on its way back. Neither reached the books before this, so the
  // order stayed fully paid and the vendor was still paid out for a sale the
  // shopper had already been refunded.
  if (event.event?.startsWith("refund.")) {
    const refund = event.payload?.refund?.entity;
    if (refund?.id) {
      if (event.event === "refund.failed") {
        await reverseFailedGatewayRefund(refund.id, {
          amount:
            typeof refund.amount === "number" && refund.currency
              ? fromRazorpayAmountSubunits(refund.amount, refund.currency)
              : undefined,
          currency: refund.currency,
        });
      } else {
        await reconcileGatewayRefundReading(readRazorpayRefund(refund));
        // Or one of the marketplace's own payments — a boost, a subscription
        // — which only Stripe's refunds ever reached.
        const { keyId, keySecret } = resolveRazorpayCredentials(
          settings.payment?.razorpay,
        );
        if (refund.payment_id && keyId && keySecret) {
          await import("@/lib/payments/platform-refund-sync")
            .then(({ syncRazorpayPlatformRefund }) =>
              syncRazorpayPlatformRefund({
                paymentId: String(refund.payment_id),
                creds: { keyId, keySecret },
              }),
            )
            .catch((error) =>
              console.error("Failed to apply a Razorpay platform refund:", error),
            );
        }
      }
    }
    return NextResponse.json({ received: true });
  }

  // Razorpay reports every refusal, and nothing here listened: a shopper
  // whose card was declined four times left no record, and the order sitting
  // `pending` gave no hint of why. Recorded, never acted on — a failed
  // payment does not cancel anything, because the same shopper usually tries
  // again on the same Razorpay order.
  if (event.event === "payment.failed") {
    const payment = event.payload?.payment?.entity;
    const razorpayOrderId =
      payment?.order_id || event.payload?.order?.entity?.id;
    if (payment) {
      // Imported here rather than at the top: these reach the models barrel,
      // and this route is loaded by tests that stub the database.
      const { Order } = await import("@/models");
      const { recordChargeFailure } = await import(
        "@/lib/payments/payment-transactions"
      );
      const { recordCheckoutPaymentEvent } = await import(
        "@/lib/orders/abandoned-checkouts"
      );
      // A refused payment on a gateway already switched over belongs to an
      // attempt, not an order — there is no order until one of the tries
      // succeeds. Binding the failure to the attempt is what lets the admin
      // show every try behind one checkout, however many there were.
      const { findAttemptByGatewayRef } = await import(
        "@/lib/payments/finalize-attempt"
      );
      const { recordAttemptFailure } = await import(
        "@/lib/checkout/checkout-attempt-store"
      );
      const attempt = razorpayOrderId
        ? await findAttemptByGatewayRef("razorpayOrderId", razorpayOrderId)
        : null;
      if (attempt) {
        await recordAttemptFailure(
          attempt._id,
          payment.error_reason || payment.error_code || undefined,
        );
      }
      const order = razorpayOrderId
        ? await Order.findOne({ razorpayOrderId })
            .select("_id orderNumber checkoutCartId")
            .lean<{
              _id: unknown;
              orderNumber?: string;
              checkoutCartId?: unknown;
            } | null>()
        : null;
      await recordChargeFailure({
        provider: "razorpay",
        paymentMethod: payment.method || "razorpay",
        externalId: payment.id,
        amount: fromRazorpayAmountSubunits(
          Number(payment.amount || 0),
          payment.currency,
        ),
        currency: payment.currency,
        failureCode: payment.error_reason || payment.error_code,
        gatewayMessage: payment.error_description,
        source: "webhook",
        orderId: order?._id,
        orderNumber: order?.orderNumber,
        checkoutAttemptId: attempt?._id,
        // Who was paying, for the card-testing counters.
        customerEmail: payment.email || undefined,
        dedupeKey: payment.id ? `razorpay:failed:${payment.id}` : undefined,
        ...(razorpayOrderId ? { metadata: { razorpayOrderId } } : {}),
      });
      await recordCheckoutPaymentEvent({
        // An attempt has no order until a try succeeds, so its refusals are
        // shown on the checkout through the attempt's own cart.
        cartId: order?.checkoutCartId ?? attempt?.cartId,
        gateway: "razorpay",
        status: "failed",
        message: payment.error_description || payment.error_reason,
        paymentId: payment.id,
      });
    }
    return NextResponse.json({ received: true });
  }

  if (event.event === "payment.captured" || event.event === "order.paid") {
    const payment = event.payload?.payment?.entity;
    const razorpayOrderId =
      payment?.order_id || event.payload?.order?.entity?.id;

    if (payment && razorpayOrderId) {
      try {
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
      } catch (error) {
        // A ValidationError is an answer that will not change on a retry: no
        // order of ours (a Payment Link, another site on the same Razorpay
        // account), a cancelled order, an amount or currency that does not
        // match. Razorpay retries any non-2xx for 24 hours and then DISABLES
        // the webhook, so acknowledging these keeps it alive for the orders
        // that depend on it — a payer whose browser never came back from the
        // bank is settled only here.
        if (error instanceof ValidationError) {
          console.error(
            `Razorpay webhook ${event.event} for ${razorpayOrderId} not applied:`,
            error.message,
          );
          return NextResponse.json({ received: true });
        }
        // Anything else (the database, Razorpay's API) may pass: 5xx, so
        // Razorpay retries.
        console.error("Failed to process Razorpay payment webhook:", error);
        return NextResponse.json(
          { error: "Failed to process webhook" },
          { status: 500 },
        );
      }
    }
  }

  return NextResponse.json({ received: true });
}
