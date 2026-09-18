import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { connectDB } from "@/lib/db";
import { getStripeForSecretKey } from "@/lib/payments/stripe";
import { getSettings } from "@/models/settings.model";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import {
  acquireWebhookLease,
  completeWebhookLease,
  failWebhookLease,
  stripeWebhookLeaseInput,
} from "@/lib/payments/webhook-event-lease";
import {
  finalizeStripeCheckoutSessionOrder,
  finalizeStripePaymentIntentOrder,
} from "@/lib/payments/stripe-orders";
import {
  processVendorCheckoutSessionCompleted,
  processVendorCheckoutSessionExpired,
  processVendorInvoicePaid,
  processVendorInvoicePaymentFailed,
  processVendorSubscriptionUpdated,
  subscriptionIdFromInvoice,
  VENDOR_APPLICATION_CHECKOUT_KIND,
} from "@/lib/vendors/vendor-stripe-billing";
import {
  promoteStripeTakeoverForSubscription,
  recordStripeTakeoverFromSession,
} from "@/lib/vendors/vendor-stripe-takeover";
import {
  processPlatformChargeRefunded,
  processPlatformCheckoutSessionCompleted,
  processPlatformCheckoutSessionExpired,
} from "@/lib/boosts/boost-billing";
import { PRODUCT_BOOST_CHECKOUT_KIND } from "@/lib/boosts/boost-checkout-binding";
import {
  PREORDER_BALANCE_CHECKOUT_KIND,
  settlePreorderBalanceFromIntent,
} from "@/lib/payments/preorder-balance";
import {
  reconcileStripeOrderRefunds,
  reverseFailedOrderRefund,
} from "@/lib/orders/order-refund-sync";
import { syncStripeDisputeEvent } from "@/lib/payments/gateway-disputes";
import Stripe from "stripe";

/**
 * POST /api/payments/webhook
 * Stripe webhook handler
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe signature" },
      { status: 400 },
    );
  }

  await connectDB();
  const settings = await getSettings();
  const stripeCreds = resolveStripeCredentials(settings.payment?.stripe);

  const webhookSecret = stripeCreds.webhookSecret;
  if (!webhookSecret) {
    console.error("Missing STRIPE_WEBHOOK_SECRET");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  const stripeSecretKey = stripeCreds.secretKey;
  if (!stripeSecretKey) {
    console.error("Missing STRIPE_SECRET_KEY");
    return NextResponse.json(
      { error: "Stripe secret key not configured" },
      { status: 500 },
    );
  }

  const stripe = getStripeForSecretKey(stripeSecretKey);
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Webhook signature verification failed:", message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const acquired = await acquireWebhookLease(stripeWebhookLeaseInput(event));
  if (!acquired) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        let handled = await processVendorCheckoutSessionCompleted(
          session,
          stripe,
        );
        // A takeover session buys nothing today — it only registers the Stripe
        // subscription that will take over when the vendor's bought period ends.
        if (!handled) {
          handled = await recordStripeTakeoverFromSession(session, stripe);
        }
        if (!handled) {
          handled = await processPlatformCheckoutSessionCompleted(session);
        }
        if (!handled) await finalizeStripeCheckoutSessionOrder(session, settings);
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        let handled = await processVendorCheckoutSessionExpired(session);
        if (!handled) {
          handled = await processPlatformCheckoutSessionExpired(session);
        }
        if (!handled) console.log("Checkout session expired:", session.id);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await processVendorSubscriptionUpdated(subscription, settings, stripe);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        let handled = await processVendorInvoicePaid(invoice, settings, stripe);
        // A subscription still on the one-shot rail is invisible to the vendor
        // processor above (it scopes to `provider: "stripe"`), which is exactly
        // how a pending takeover stays safe until it is paid. This is that
        // payment: the first real Stripe invoice, and the point the row moves.
        if (!handled) {
          const takeoverSubscriptionId = subscriptionIdFromInvoice(invoice);
          handled = takeoverSubscriptionId
            ? await promoteStripeTakeoverForSubscription(
                takeoverSubscriptionId,
                settings,
              )
            : false;
        }
        if (!handled) console.log("Invoice paid:", invoice.id);
        break;
      }

      case "invoice.payment_failed":
      case "invoice.payment_action_required": {
        const invoice = event.data.object as Stripe.Invoice;
        const handled = await processVendorInvoicePaymentFailed(
          invoice,
          settings,
          stripe,
        );
        if (!handled) console.log("Invoice payment failed:", invoice.id);
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const rawIntent = paymentIntent as unknown as { invoice?: unknown };
        if (paymentIntent.metadata?.kind === PREORDER_BALANCE_CHECKOUT_KIND) {
          // The balance on an existing pre-order — there is no cart behind
          // it, so the checkout finalizer must never see it.
          await settlePreorderBalanceFromIntent(paymentIntent, settings);
        } else if (
          paymentIntent.metadata?.kind !== VENDOR_APPLICATION_CHECKOUT_KIND &&
          paymentIntent.metadata?.kind !== PRODUCT_BOOST_CHECKOUT_KIND &&
          !rawIntent.invoice
        ) {
          await finalizeStripePaymentIntentOrder(paymentIntent, settings);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        if (
          paymentIntent.metadata?.kind !== VENDOR_APPLICATION_CHECKOUT_KIND &&
          paymentIntent.metadata?.kind !== PRODUCT_BOOST_CHECKOUT_KIND &&
          paymentIntent.metadata?.kind !== PREORDER_BALANCE_CHECKOUT_KIND
        ) {
          console.log("Payment failed:", paymentIntent.id);
        }
        break;
      }

      case "charge.refunded": {
        // Platform payments fully refunded from the Stripe dashboard tear the
        // benefit down (partial refunds are left intact — see the handler).
        const charge = event.data.object as Stripe.Charge;
        const handled = await processPlatformChargeRefunded(charge);
        if (handled) break;

        // Not a platform payment, so it is an ORDER. A refund issued from the
        // Stripe dashboard used to end here with a console line: no
        // transaction row, no ledger entry, `refundedTotal` untouched — and
        // the vendor still paid out in full for a sale the shopper had already
        // been refunded. Matched by Stripe's own refund id, so a refund
        // Storify raised itself is recognised and nothing is recorded twice.
        const recorded = await reconcileStripeOrderRefunds(charge, stripe);
        if (recorded > 0) {
          console.log(
            `Recorded ${recorded} gateway-issued refund(s) for charge ${charge.id}`,
          );
        }
        break;
      }

      case "refund.failed":
      case "refund.updated": {
        // A card refund is accepted first and settled later, and it can fail
        // after — a closed account, a bank that rejects the credit. Without
        // this the books said money went back that never did.
        const refund = event.data.object as Stripe.Refund;
        await reverseFailedOrderRefund(refund);
        break;
      }

      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.funds_withdrawn":
      case "charge.dispute.funds_reinstated":
      case "charge.dispute.closed": {
        // One handler for the whole dispute: the chargeback recorded as a
        // refund when Stripe withdraws the money, reversed if it is reinstated,
        // its fee booked, and an admin told what changed. Read back from Stripe
        // first — these events arrive in any order, and an older copy must not
        // undo a newer decision. See `applyGatewayDispute`.
        const dispute = event.data.object as Stripe.Dispute;
        await syncStripeDisputeEvent(stripe, dispute);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    await completeWebhookLease("stripe", event.id);
  } catch (error) {
    await failWebhookLease("stripe", event.id, error);
    throw error;
  }

  return NextResponse.json({ received: true });
}
