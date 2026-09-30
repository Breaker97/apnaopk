import { NextRequest, NextResponse } from "next/server";

import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { verifyPayPalWebhookSignature, type PayPalMode } from "@/lib/payments/paypal";
import { ValidationError } from "@/lib/api/errors";
import { resolvePayPalCredentials } from "@/lib/settings/credentials";
import { finalizePayPalOrder } from "@/lib/payments/paypal-orders";
import { settlePreorderBalanceFromPayPal } from "@/lib/payments/preorder-balance-paypal";
import { findPlatformPaymentByPayPalOrderId } from "@/lib/payments/platform-payments";
import {
  readPayPalRefund,
  readPayPalReversal,
  reconcileGatewayRefundReading,
  reverseFailedGatewayRefund,
} from "@/lib/orders/order-refund-sync";
import { syncPayPalDisputeEvent } from "@/lib/payments/gateway-disputes";
import type { PayPalDisputeLike } from "@/lib/orders/dispute-readings";

/**
 * POST /api/payments/paypal/webhook
 *
 * PayPal had no webhook at all, which meant a refund issued from the PayPal
 * dashboard reached Storify nowhere: no transaction row, no ledger entry, the
 * order still reading as fully paid, and the vendor still paid out for a sale
 * the shopper already had their money back for. A refund that PayPal later
 * cancelled was equally invisible in the other direction.
 *
 * Refund events, and one capture event. A capture normally arrives through
 * the client-side capture call — but a capture PayPal holds PENDING (a review,
 * an eCheck) is refused there, and completes later with no shopper on the
 * page to call again. `PAYMENT.CAPTURE.COMPLETED` is the only thing that says
 * so. It runs the same finalizers the capture route does, which are guarded,
 * so the two paths landing together record the payment once.
 *
 * And refusals: a denied capture leaves no order to look at, so it is written
 * to the payment log and to the checkout's own timeline instead.
 *
 * And disputes. A reversal (`PAYMENT.CAPTURE.REVERSED`) is money PayPal took
 * back for a chargeback or a lost claim, recorded as a chargeback rather than
 * as a refund an admin sent. The dispute events tell an admin a dispute needs
 * answering, book PayPal's dispute and chargeback fees, and give the money
 * back to the books when a dispute is won — read from PayPal's Disputes API,
 * which is the only copy that says what money moved.
 */

/** The refund resource, as PayPal delivers it. */
type PayPalRefundResource = {
  id?: string;
  status?: string;
  amount?: { value?: string; currency_code?: string } | null;
  links?: Array<{ rel?: string; href?: string }> | null;
  capture_id?: string;
  /** Why PayPal declined, on a denial event. */
  status_details?: { reason?: string } | null;
  /** On a capture event: the PayPal order the capture belongs to. */
  supplementary_data?: { related_ids?: { order_id?: string } } | null;
};

type PayPalWebhookEvent = {
  event_type?: string;
  resource?: PayPalRefundResource & PayPalDisputeLike;
};

/** Events that say money went back, or stopped going back. */
const REFUND_EVENTS = new Set([
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.REFUND.COMPLETED",
]);
/** PayPal took the money back: a card chargeback, or a claim the store lost. */
const REVERSAL_EVENT = "PAYMENT.CAPTURE.REVERSED";
/** A dispute opened, changed, or was decided. `RISK.DISPUTE.CREATED` is the older name. */
const DISPUTE_EVENTS = new Set([
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
  "RISK.DISPUTE.CREATED",
]);
const REFUND_FAILURE_EVENTS = new Set([
  "PAYMENT.REFUND.FAILED",
  "PAYMENT.REFUND.CANCELLED",
]);
/** A capture PayPal has finished — including one it first held as pending. */
const CAPTURE_COMPLETED_EVENT = "PAYMENT.CAPTURE.COMPLETED";
/**
 * PayPal refused the money: the buyer's funding source declined
 * (`PAYMENT.CAPTURE.DENIED`), or PayPal itself turned the order down
 * (`CHECKOUT.ORDER.DECLINED`). Recorded, never acted on — the shopper is
 * still on PayPal's page and may pay with another funding source, so
 * cancelling their order here would take it out from under them.
 *
 * Both have to be subscribed to in the PayPal app's webhook settings; a store
 * that has not simply records nothing, exactly as before.
 */
const CAPTURE_DENIED_EVENTS = new Set([
  "PAYMENT.CAPTURE.DENIED",
  "CHECKOUT.ORDER.DECLINED",
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
    if (eventType === CAPTURE_COMPLETED_EVENT) {
      const paypalOrderId = resource?.supplementary_data?.related_ids?.order_id;
      if (paypalOrderId) {
        await recordCompletedCapture(paypalOrderId, settings);
      }
    } else if (CAPTURE_DENIED_EVENTS.has(eventType)) {
      // Imported here rather than at the top: these reach the models barrel,
      // and this route is loaded by tests that stub the database.
      const { Order } = await import("@/models");
      const { recordChargeFailure } = await import(
        "@/lib/payments/payment-transactions"
      );
      const { recordCheckoutPaymentEvent } = await import(
        "@/lib/orders/abandoned-checkouts"
      );
      const paypalOrderId =
        resource?.supplementary_data?.related_ids?.order_id ||
        (eventType === "CHECKOUT.ORDER.DECLINED" ? resource?.id : undefined);
      // On a gateway already switched over, a refused capture belongs to an
      // attempt — there is no order until a try succeeds. Without this the
      // refusal was filed against nothing: no try counted on the attempt, and
      // nothing on the checkout's payment timeline.
      const { findAttemptByGatewayRef } = await import(
        "@/lib/payments/finalize-attempt"
      );
      const { recordAttemptFailure } = await import(
        "@/lib/checkout/checkout-attempt-store"
      );
      const attempt = paypalOrderId
        ? await findAttemptByGatewayRef("paypalOrderId", paypalOrderId)
        : null;
      if (attempt) await recordAttemptFailure(attempt._id, eventType);
      const order = paypalOrderId
        ? await Order.findOne({
            // A pay link's PayPal approval is kept apart from the checkout's.
            $or: [{ paypalOrderId }, { payLinkPaypalOrderId: paypalOrderId }],
          })
            .select("_id orderNumber checkoutCartId total currency")
            .lean<{
              _id: unknown;
              orderNumber?: string;
              checkoutCartId?: unknown;
              total?: number;
              currency?: string;
            } | null>()
        : null;
      await recordChargeFailure({
        provider: "paypal",
        paymentMethod: "paypal",
        externalId: resource?.id || paypalOrderId,
        // PayPal quotes money in major units already.
        amount: Number(
          resource?.amount?.value ??
            order?.total ??
            attempt?.snapshot?.total ??
            0,
        ),
        currency:
          resource?.amount?.currency_code ||
          order?.currency ||
          (attempt?.snapshot?.currency as string | undefined),
        failureCode: eventType,
        gatewayMessage: resource?.status_details?.reason,
        source: "webhook",
        orderId: order?._id,
        orderNumber: order?.orderNumber,
        checkoutAttemptId: attempt?._id,
        dedupeKey: resource?.id ? `paypal:denied:${resource.id}` : undefined,
        ...(paypalOrderId ? { metadata: { paypalOrderId } } : {}),
      });
      await recordCheckoutPaymentEvent({
        cartId: order?.checkoutCartId ?? attempt?.cartId,
        gateway: "paypal",
        status: "failed",
        message: resource?.status_details?.reason || eventType,
        paymentId: resource?.id || paypalOrderId,
      });
    } else if (DISPUTE_EVENTS.has(eventType)) {
      const disputeId = String(resource?.dispute_id || "");
      if (disputeId) {
        await syncPayPalDisputeEvent({
          disputeId,
          resource,
          creds: {
            clientId: paypal.clientId,
            clientSecret: paypal.clientSecret,
            mode: ((paypal.mode as PayPalMode) || "sandbox") as PayPalMode,
          },
        });
      }
    } else if (eventType === REVERSAL_EVENT && resource) {
      await reconcileGatewayRefundReading(readPayPalReversal(resource));
    } else if (REFUND_FAILURE_EVENTS.has(eventType) && resource?.id) {
      // The amount rides along, so a failed part of a refund is left waiting
      // for the one the admin sends again rather than counted twice.
      const failedValue = Number(
        (resource as { amount?: { value?: string } }).amount?.value,
      );
      await reverseFailedGatewayRefund(resource.id, {
        amount: Number.isFinite(failedValue) ? failedValue : undefined,
        currency: (resource as { amount?: { currency_code?: string } }).amount
          ?.currency_code,
      });
    } else if (REFUND_EVENTS.has(eventType) && resource) {
      const recorded = await reconcileGatewayRefundReading(
        readPayPalRefund(resource),
      );
      // Or one of the marketplace's own payments — a boost, a subscription —
      // which only Stripe's refunds ever reached.
      await import("@/lib/payments/platform-refund-sync")
        .then(({ syncPayPalPlatformRefund }) => syncPayPalPlatformRefund(resource))
        .catch((error) =>
          console.error("Failed to apply a PayPal platform refund:", error),
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

/**
 * Record a capture PayPal reports complete, on whichever order it belongs to.
 *
 * A pre-order balance first, then a checkout order — the order the capture
 * route tries them in. Vendor platform payments are left to their own capture
 * call. A finalizer's ValidationError is an answer, not an outage (no order,
 * an amount that does not match, an order cancelled underneath it), so it is
 * logged and acknowledged; PayPal retrying it would only get the same answer.
 */
async function recordCompletedCapture(
  paypalOrderId: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
) {
  if (await findPlatformPaymentByPayPalOrderId(paypalOrderId)) return;

  try {
    const balance = await settlePreorderBalanceFromPayPal({
      paypalOrderId,
      settings,
    });
    if (balance.reason !== "not_a_balance_order") return;

    const creds = resolvePayPalCredentials(settings.payment?.paypal);
    if (!creds.clientId || !creds.clientSecret) return;
    await finalizePayPalOrder({
      paypalOrderId,
      creds: {
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        mode: creds.mode,
      },
      settings,
      alreadyCaptured: true,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error(
        `PayPal capture for order ${paypalOrderId} was not recorded:`,
        error.message,
      );
      return;
    }
    throw error;
  }
}
