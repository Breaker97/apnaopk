/**
 * POST /api/vendor/subscription/switch-to-stripe
 *
 * Move a pay-per-period subscription onto Stripe's auto-renewal. The mirror of
 * `switchFromStripe` on the renew route, and the harder direction: the vendor
 * has already paid through `currentPeriodEnd`, so the Stripe subscription is
 * created with a trial to that date and must not charge before it.
 *
 * Nothing about the local row's billing moves here. Completing this checkout
 * only records the pending subscription in the `stripeTakeover*` columns; the
 * row stays on its current gateway and its current clock until Stripe's first
 * real invoice is paid, at which point lib/vendor-stripe-takeover promotes it.
 * That deferral is what stops a trialing subscription — which has no paid
 * invoice, and so no activation evidence — from reading as an unpaid vendor.
 */

import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { VendorPlan, VendorSubscription } from "@/models";
import { getStripeForSecretKey } from "@/lib/payments/stripe";
import {
  assertStripeBillingReady,
  ensureStripePriceForVendorPlan,
} from "@/lib/vendors/vendor-plan-stripe";
import {
  buildStripeTakeoverMetadata,
  VENDOR_STRIPE_TAKEOVER_KIND,
} from "@/lib/vendors/vendor-stripe-takeover";
import { VENDOR_SUBSCRIPTION_STATUS } from "@/config/app.config";

const SwitchSchema = z.object({
  locale: z.string().min(2).max(12).optional(),
});

const IN_FLIGHT_CHANGE_STATUSES = [
  "awaiting_vendor",
  "awaiting_payment",
  "scheduled",
];

function appUrlForRequest(request: Request) {
  return (
    request.headers.get("origin") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:subscription:switchToStripe", preset: "moderate" },
    demo: "block-mutations",
  },
  async ({ request, session }) => {
    const settings = await getSettings();
    if (
      !settings.multiVendorMode?.enabled ||
      !settings.vendorConfig?.plansEnabled
    ) {
      throw new NotFoundError("Vendor plans");
    }
    if (settings.vendorConfig?.paymentMethods?.stripe === false) {
      throw new ValidationError(
        "Stripe is not an available payment method for vendor plans",
      );
    }

    const body = await validateBody(request, SwitchSchema);
    const vendor = await requireApprovedVendorByUserId(session.user.id);

    const subscription = await VendorSubscription.findOne({
      vendorId: vendor._id,
      occupiesActiveSlot: true,
    })
      .select(
        "provider status applicationId planId planSnapshot currentPeriodEnd pendingChangeStatus stripeCustomerId stripeTakeoverSubscriptionId",
      )
      .lean<{
        _id: unknown;
        provider?: string;
        status?: string;
        applicationId?: unknown;
        planId?: unknown;
        currentPeriodEnd?: Date | null;
        pendingChangeStatus?: string | null;
        stripeCustomerId?: string | null;
        stripeTakeoverSubscriptionId?: string | null;
        planSnapshot?: {
          name?: string;
          price?: number;
          billingInterval?: string;
          stripePriceId?: string | null;
        } | null;
      } | null>();
    if (!subscription) throw new NotFoundError("Vendor subscription");

    if (subscription.provider === "stripe") {
      throw new ValidationError("This plan already renews through Stripe");
    }
    if (subscription.stripeTakeoverSubscriptionId) {
      throw new ValidationError(
        "A switch to Stripe is already pending on this subscription",
      );
    }
    if (
      IN_FLIGHT_CHANGE_STATUSES.includes(String(subscription.pendingChangeStatus))
    ) {
      throw new ValidationError(
        "Finish or cancel the pending plan change before switching payment method",
      );
    }
    if (
      !subscription.planSnapshot?.billingInterval ||
      subscription.planSnapshot.billingInterval === "none" ||
      Number(subscription.planSnapshot.price || 0) <= 0
    ) {
      throw new ValidationError("This plan has nothing to bill");
    }
    // Only a live, paid-through subscription can hand over cleanly: the trial
    // date below IS the paid-through date, and a lapsed row has none to offer.
    if (subscription.status !== VENDOR_SUBSCRIPTION_STATUS.ACTIVE) {
      throw new ValidationError(
        "Only an active subscription can be switched to automatic renewal",
      );
    }
    const paidThrough = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd)
      : null;
    if (!paidThrough || paidThrough.getTime() <= Date.now()) {
      throw new ValidationError(
        "This period has already ended — renew it first, then switch to automatic renewal",
      );
    }

    const stripe = getStripeForSecretKey(assertStripeBillingReady(settings));

    // The trusted price for the plan, synced on demand: a plan that has only
    // ever been sold through Pesapal may never have had a Stripe price, and the
    // takeover cannot be promoted later without one to check against.
    const plan = await VendorPlan.findById(String(subscription.planId));
    if (!plan) throw new NotFoundError("Vendor plan");
    const { stripePriceId } = await ensureStripePriceForVendorPlan(plan, settings);
    if (!stripePriceId) {
      throw new ValidationError("This plan has no Stripe price to bill against");
    }
    // Recorded on the subscription too, because promotion compares Stripe's
    // reported price against the snapshot rather than against the live plan.
    await VendorSubscription.updateOne(
      { _id: String(subscription._id) },
      { $set: { "planSnapshot.stripePriceId": stripePriceId } },
    );

    let stripeCustomerId = subscription.stripeCustomerId || vendor.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create(
        {
          email: session.user.email || undefined,
          name: session.user.name || vendor.storeName || undefined,
          metadata: {
            kind: VENDOR_STRIPE_TAKEOVER_KIND,
            vendorId: String(vendor._id),
            userId: session.user.id,
          },
        },
        { idempotencyKey: `vendor-takeover-customer-${String(subscription._id)}` },
      );
      stripeCustomerId = customer.id;
    }

    const locale = body.locale || "en";
    const origin = appUrlForRequest(request);
    const metadata = buildStripeTakeoverMetadata({
      applicationId: subscription.applicationId
        ? String(subscription.applicationId)
        : null,
      vendorId: String(vendor._id),
      userId: session.user.id,
      planId: String(subscription.planId),
      subscriptionId: String(subscription._id),
    });

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      // The session collects a card without charging it: the trial below means
      // nothing is due today, and without this Stripe would not store one.
      payment_method_collection: "always",
      customer: stripeCustomerId,
      line_items: [{ price: stripePriceId, quantity: 1 }],
      subscription_data: {
        // The vendor already paid for every day up to here through the other
        // gateway. Stripe's first charge lands the moment that runs out, so the
        // handover costs them nothing and leaves no unpaid gap.
        trial_end: Math.floor(paidThrough.getTime() / 1000),
        metadata,
      },
      metadata,
      success_url: `${origin}/${locale}/vendor/billing?stripe_switch=success`,
      cancel_url: `${origin}/${locale}/vendor/billing?stripe_switch=cancelled`,
    });

    if (!checkoutSession.url) {
      throw new ValidationError("Stripe did not return a checkout URL");
    }

    return successResponse({
      url: checkoutSession.url,
      sessionId: checkoutSession.id,
      paidThrough: paidThrough.toISOString(),
    });
  },
);
