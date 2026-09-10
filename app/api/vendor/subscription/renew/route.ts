/**
 * POST /api/vendor/subscription/renew
 * One-shot renewal for non-Stripe subscriptions: pays the next period
 * through any enabled gateway. The manual-recurring clock advances in
 * recordOneShotSubscriptionPayment when the gateway confirms.
 *
 * A Stripe subscription renews itself and is refused here — unless the vendor
 * passes `switchFromStripe`, which is how a store moves off Stripe onto a
 * gateway Stripe cannot reach (Pesapal, ioTec, and the rest). That path buys
 * the next period through the new gateway first and only then cancels the
 * Stripe subscription, so an abandoned checkout changes nothing and a vendor
 * mid-period keeps every day they have already paid for: the period extends
 * from `currentPeriodEnd` rather than restarting.
 */

import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { PlatformPayment, VendorSubscription } from "@/models";
import {
  createPlatformPaymentAttempt,
  initiatePlatformPayment,
} from "@/lib/payments/platform-payments";
import { resolveVendorBillingProviders } from "@/lib/vendors/vendor-billing-providers";
import {
  PLATFORM_PAYMENT_KIND,
  PLATFORM_PAYMENT_STATUS,
  VENDOR_BILLING_INTERVAL,
  VENDOR_SUBSCRIPTION_STATUS,
  PLATFORM_PAYMENT_GATEWAYS
} from "@/config/app.config";

const RenewSchema = z.object({
  paymentMethod: z.enum(PLATFORM_PAYMENT_GATEWAYS),
  locale: z.string().min(2).max(12).optional(),
  iotecChannel: z.enum(["mobile_money", "card"]).optional(),
  iotecPhone: z.string().max(30).optional(),
  mtnMomoPhone: z.string().max(30).optional(),
  /**
   * Move a Stripe-billed subscription onto a one-shot gateway. Explicit rather
   * than inferred from the chosen method, because it ends an auto-renewing
   * subscription: a vendor must ask for that, never trip over it by picking a
   * different button.
   */
  switchFromStripe: z.boolean().optional(),
});

/** Stripe-side plan changes that a switch would strand half-applied. */
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
    rateLimit: { action: "vendor:subscription:renew", preset: "moderate" },
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

    const body = await validateBody(request, RenewSchema);
    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    const subscription = await VendorSubscription.findOne({
      vendorId: vendor._id,
      occupiesActiveSlot: true,
    })
      .select(
        "provider status applicationId planId planSnapshot currentPeriodEnd pendingChangeStatus",
      )
      .lean<{
        _id: unknown;
        provider?: string;
        status?: string;
        applicationId?: unknown;
        planId?: unknown;
        pendingChangeStatus?: string | null;
        planSnapshot?: {
          name?: string;
          price?: number;
          currency?: string;
          billingInterval?: string;
        } | null;
      } | null>();
    if (!subscription) throw new NotFoundError("Vendor subscription");

    const isSwitchingOffStripe =
      subscription.provider === "stripe" && body.switchFromStripe === true;

    if (subscription.provider === "stripe" && !isSwitchingOffStripe) {
      throw new ValidationError(
        "Stripe subscriptions renew automatically — manage them in the billing portal",
      );
    }
    // A staged upgrade or downgrade lives inside Stripe, as an open invoice or
    // a subscription schedule. Cancelling the subscription underneath it — which
    // is what completing this payment does — would strand the change with no
    // way to finish it, so the vendor resolves it first. Refusing here is much
    // cheaper than teaching the switch how to unwind a Stripe schedule.
    if (
      isSwitchingOffStripe &&
      IN_FLIGHT_CHANGE_STATUSES.includes(String(subscription.pendingChangeStatus))
    ) {
      throw new ValidationError(
        "Finish or cancel the pending plan change before switching payment method",
      );
    }
    if (
      !subscription.planSnapshot?.billingInterval ||
      subscription.planSnapshot.billingInterval ===
        VENDOR_BILLING_INTERVAL.NONE ||
      Number(subscription.planSnapshot.price || 0) <= 0
    ) {
      throw new ValidationError("This plan has nothing to renew");
    }
    const renewableStatuses: string[] = [
      VENDOR_SUBSCRIPTION_STATUS.ACTIVE,
      VENDOR_SUBSCRIPTION_STATUS.PAST_DUE,
    ];
    if (!renewableStatuses.includes(String(subscription.status))) {
      throw new ValidationError(
        "This subscription is not in a renewable state",
      );
    }

    const available = resolveVendorBillingProviders(settings);
    if (
      body.paymentMethod === "stripe" ||
      !available.includes(body.paymentMethod)
    ) {
      throw new ValidationError(
        "This payment method is not available for renewals",
      );
    }

    const currency = (
      subscription.planSnapshot.currency ||
      settings.general?.defaultCurrency ||
      "USD"
    ).toUpperCase();
    const payment = await createPlatformPaymentAttempt({
      kind: PLATFORM_PAYMENT_KIND.SUBSCRIPTION,
      subscriptionId: String(subscription._id),
      planId: subscription.planId ? String(subscription.planId) : undefined,
      vendorId: String(vendor._id),
      userId: session.user.id,
      provider: body.paymentMethod,
      amount: Number(subscription.planSnapshot.price),
      currency,
    });

    const activeLocale = body.locale || "en";
    const origin = appUrlForRequest(request);
    try {
      const initiation = await initiatePlatformPayment({
        payment,
        settings,
        successUrl: `${origin}/${activeLocale}/vendor/dashboard?vendor_payment=success&platform_payment=${String(payment._id)}`,
        cancelUrl: `${origin}/${activeLocale}/vendor/dashboard?vendor_payment=cancelled`,
        payer: {
          email: session.user.email || "",
          name: session.user.name || vendor.storeName,
          phone: body.iotecPhone || vendor.address?.phone,
          address: {
            country: vendor.address?.country,
            city: vendor.address?.city,
            street: vendor.address?.street,
            state: vendor.address?.state,
            postalCode: vendor.address?.postalCode,
          },
        },
        description: isSwitchingOffStripe
          ? `Vendor plan payment: ${subscription.planSnapshot.name || "plan"}`
          : `Vendor plan renewal: ${subscription.planSnapshot.name || "plan"}`,
        iotecChannel: body.iotecChannel,
        iotecPhone: body.iotecPhone,
        mtnMomoPhone: body.mtnMomoPhone,
      });

      return successResponse({
        paymentId: String(payment._id),
        provider: body.paymentMethod,
        ...initiation,
      });
    } catch (error) {
      await PlatformPayment.updateOne(
        { _id: payment._id, status: PLATFORM_PAYMENT_STATUS.PENDING },
        {
          $set: {
            status: PLATFORM_PAYMENT_STATUS.FAILED,
            failedAt: new Date(),
            failureReason:
              error instanceof Error ? error.message : "Initiation failed",
          },
        },
      ).catch(() => undefined);
      throw error;
    }
  },
);
