import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import type Stripe from "stripe";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import {
  PlatformPayment,
  Vendor,
  VendorApplication,
  VendorPlan,
  VendorSubscription,
} from "@/models";
import {
  createPlatformPaymentAttempt,
  initiatePlatformPayment,
} from "@/lib/payments/platform-payments";
import { resolveVendorBillingProviders } from "@/lib/vendors/vendor-billing-providers";
import {
  PLATFORM_PAYMENT_KIND,
  PLATFORM_PAYMENT_STATUS,
  PLATFORM_PAYMENT_GATEWAYS
} from "@/config/app.config";
import { getSettings } from "@/models/settings.model";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/api/validate";
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  handleApiError,
} from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import {
  buildVendorCheckoutMetadata,
  claimVendorCheckoutSession,
  decideVendorCheckoutClaimDisposition,
  expireSupersededVendorCheckoutSession,
  reusableVendorCheckoutSessionUrl,
  selectVendorCheckoutSubscription,
} from "@/lib/vendors/vendor-checkout-binding";
import {
  assertStripeBillingReady,
  assertVendorPlanStillOffered,
  ensureStripePriceForVendorPlan,
} from "@/lib/vendors/vendor-plan-stripe";
import { findLatestVendorApplication } from "@/lib/vendors/vendor-application";
import { getStripeForSecretKey } from "@/lib/payments/stripe";
import {
  VENDOR_APPLICATION_PAYMENT_STATUS,
  VENDOR_APPLICATION_STATUS,
  VENDOR_BILLING_INTERVAL,
  VENDOR_STATUS,
  VENDOR_SUBSCRIPTION_STATUS,
} from "@/config/app.config";
import { assertStorefrontWriteAllowed } from "@/lib/maintenance";

const CheckoutBodySchema = z.object({
  locale: z.string().min(2).max(12).optional(),
  // Absent/"stripe" keeps the native recurring Checkout flow; any other
  // gateway pays the first period as a one-shot PlatformPayment.
  // The shared registry, not a copy: a hand-kept list here silently drops any
  // gateway added later — which is exactly how Orange Money went missing.
  paymentMethod: z.enum(PLATFORM_PAYMENT_GATEWAYS).optional(),
  iotecChannel: z.enum(["mobile_money", "card"]).optional(),
  iotecPhone: z.string().max(30).optional(),
  mtnMomoPhone: z.string().max(30).optional(),
});

function appUrlForRequest(request: NextRequest) {
  return (
    request.headers.get("origin") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

async function reusableCheckoutUrl(
  stripe: Stripe,
  sessionId: string | null | undefined,
  applicationId: string,
  localSubscriptionId: string,
) {
  if (!sessionId) return null;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return reusableVendorCheckoutSessionUrl(
      session,
      applicationId,
      localSubscriptionId,
    );
  } catch {
    return null;
  }
}

async function expireOpenCheckoutSession(
  stripe: Stripe,
  sessionId: string,
): Promise<void> {
  try {
    await expireSupersededVendorCheckoutSession(
      stripe.checkout.sessions,
      sessionId,
    );
  } catch (error) {
    console.error("Failed to expire superseded vendor Checkout Session", error);
  }
}

/**
 * POST /api/vendor/applications/checkout
 * Starts billing only for an admin-verified, payment-required vendor.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:application:checkout",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    assertStorefrontWriteAllowed(
      settings.maintenance,
      settings.general?.storeName,
    );
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const body = await validateBody(request, CheckoutBodySchema);
    const vendor = await Vendor.findOne({ userId: session.user.id });
    if (!vendor) throw new NotFoundError("Vendor");

    const application = await findLatestVendorApplication({
      vendorId: vendor._id,
      userId: session.user.id,
    });
    if (
      !application ||
      application.status !== VENDOR_APPLICATION_STATUS.APPROVED
    ) {
      throw new ValidationError(
        "Your application must be approved before payment",
      );
    }
    const incompleteSubscriptions = await VendorSubscription.find({
      vendorId: vendor._id,
      applicationId: application._id,
      status: VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
      provider: "stripe",
    })
      .sort({ createdAt: -1 })
      .limit(2)
      .select(
        "_id applicationId stripeCustomerId stripeCheckoutSessionId stripePriceId planSnapshot.stripePriceId providerStatus",
      )
      .lean<
        Array<{
          _id: unknown;
          applicationId?: unknown;
          stripeCustomerId?: string | null;
          stripeCheckoutSessionId?: string | null;
          stripePriceId?: string | null;
          planSnapshot?: { stripePriceId?: string | null } | null;
          providerStatus?: string | null;
        }>
      >();
    const approvedFreePlanUpgrade =
      vendor.status === VENDOR_STATUS.APPROVED &&
      incompleteSubscriptions.length > 0;
    if (
      vendor.status !== VENDOR_STATUS.PAYMENT_REQUIRED &&
      !approvedFreePlanUpgrade
    ) {
      throw new ValidationError(
        vendor.status === VENDOR_STATUS.APPROVED
          ? "Your vendor subscription is already active"
          : "Your application must be approved before payment",
      );
    }
    const checkoutSubscription = selectVendorCheckoutSubscription(
      incompleteSubscriptions.map((row) => ({
        id: String(row._id),
        applicationId: row.applicationId ? String(row.applicationId) : null,
      })),
      String(application._id),
    );
    const selectedSubscription = incompleteSubscriptions.find(
      (row) => String(row._id) === checkoutSubscription.id,
    );
    if (!selectedSubscription) {
      throw new ValidationError(
        "Vendor subscription billing record is missing",
      );
    }
    if (
      !application.planId ||
      !application.planSnapshot ||
      application.planSnapshot.billingInterval ===
        VENDOR_BILLING_INTERVAL.NONE ||
      Number(application.planSnapshot.price || 0) <= 0
    ) {
      throw new ValidationError("This application does not require payment");
    }
    const eligiblePaymentStatuses: string[] = [
      VENDOR_APPLICATION_PAYMENT_STATUS.UNPAID,
      VENDOR_APPLICATION_PAYMENT_STATUS.PENDING,
      VENDOR_APPLICATION_PAYMENT_STATUS.FAILED,
    ];
    if (!eligiblePaymentStatuses.includes(application.paymentStatus)) {
      throw new ValidationError(
        application.paymentStatus ===
          VENDOR_APPLICATION_PAYMENT_STATUS.PAID
          ? "Your vendor subscription is already paid"
          : "This vendor subscription is not eligible for Checkout",
      );
    }

    const now = new Date();

    // Non-Stripe gateways: one-shot first-period charge over the shared
    // platform-payment rail. Activation (subscription clock, application
    // paid, vendor access) happens in recordOneShotSubscriptionPayment when
    // the gateway confirms.
    const paymentMethod = body.paymentMethod || "stripe";
    // Every method is checked against the admin's allowlist, Stripe included.
    // Only the non-Stripe branch used to be validated, so a request that simply
    // omitted `paymentMethod` fell through to the Stripe default and started a
    // native recurring subscription the admin had deliberately disabled under
    // Vendor config → payment methods.
    const available = resolveVendorBillingProviders(settings);
    if (!available.includes(paymentMethod)) {
      throw new ValidationError(
        "This payment method is not available for vendor subscriptions",
      );
    }
    if (paymentMethod !== "stripe") {
      const currency = (
        application.planSnapshot.currency ||
        settings.general?.defaultCurrency ||
        "USD"
      ).toUpperCase();
      const payment = await createPlatformPaymentAttempt({
        kind: PLATFORM_PAYMENT_KIND.SUBSCRIPTION,
        subscriptionId: checkoutSubscription.id,
        applicationId: String(application._id),
        planId: String(application.planId),
        vendorId: String(vendor._id),
        userId: session.user.id,
        provider: paymentMethod,
        amount: Number(application.planSnapshot.price),
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
          description: `Vendor plan: ${application.planSnapshot.name}`,
          iotecChannel: body.iotecChannel,
          iotecPhone: body.iotecPhone,
          mtnMomoPhone: body.mtnMomoPhone,
        });

        await VendorApplication.updateOne(
          { _id: application._id },
          {
            $set: {
              paymentStatus: VENDOR_APPLICATION_PAYMENT_STATUS.PENDING,
            },
          },
        );

        return successResponse({
          paymentId: String(payment._id),
          applicationId: String(application._id),
          provider: paymentMethod,
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
    }

    const secretKey = assertStripeBillingReady(settings);
    const stripe = getStripeForSecretKey(secretKey);
    const applicationId = String(application._id);
    const openUrl = await reusableCheckoutUrl(
      stripe,
      application.stripeCheckoutSessionId,
      applicationId,
      checkoutSubscription.id,
    );
    if (openUrl) {
      return successResponse({
        url: openUrl,
        sessionId: application.stripeCheckoutSessionId,
        applicationId,
      });
    }

    let stripePriceId = application.planSnapshot.stripePriceId || null;
    if (!stripePriceId) {
      const plan = await VendorPlan.findById(application.planId);
      if (!plan) {
        throw new ValidationError("Selected vendor plan no longer exists");
      }
      assertVendorPlanStillOffered(plan);
      if (
        Number(plan.price) !== Number(application.planSnapshot.price) ||
        plan.billingInterval !== application.planSnapshot.billingInterval
      ) {
        throw new ValidationError(
          "The selected plan changed after submission. Ask an admin to reopen the application with the current price.",
        );
      }
      const stripeFields = await ensureStripePriceForVendorPlan(plan, settings);
      stripePriceId = stripeFields.stripePriceId;
      application.planSnapshot.stripeProductId =
        stripeFields.stripeProductId;
      application.planSnapshot.stripePriceId = stripePriceId;
      application.planSnapshot.currency =
        stripeFields.stripePriceCurrency;
    }

    let stripeCustomerId =
      application.stripeCustomerId || vendor.stripeCustomerId || null;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create(
        {
          email: session.user.email || undefined,
          name: session.user.name || undefined,
          metadata: {
            kind: "vendor_subscription",
            applicationId,
            vendorId: String(vendor._id),
            userId: session.user.id,
          },
        },
        { idempotencyKey: `vendor-billing-customer-${applicationId}` },
      );
      stripeCustomerId = customer.id;
    }

    const locale = body.locale || "en";
    const origin = appUrlForRequest(request);
    const metadata = buildVendorCheckoutMetadata({
      applicationId,
      vendorId: String(vendor._id),
      userId: session.user.id,
      planId: String(application.planId),
      subscriptionId: checkoutSubscription.id,
    });
    const previousSessionKey =
      application.stripeCheckoutSessionId || "initial";
    const checkoutExpiresAt =
      Math.floor(now.getTime() / 1000) + 24 * 60 * 60;
    const checkoutSession = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        payment_method_types: ["card"],
        payment_method_collection: "always",
        customer: stripeCustomerId,
        client_reference_id: applicationId,
        line_items: [{ price: stripePriceId, quantity: 1 }],
        subscription_data: { metadata },
        metadata,
        expires_at: checkoutExpiresAt,
        success_url: `${origin}/${locale}/vendor/dashboard?vendor_payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/${locale}/vendor/dashboard?vendor_payment=cancelled`,
      },
      {
        idempotencyKey: `vendor-billing-checkout-${applicationId}-${previousSessionKey}`,
      },
    );

    const checkoutExpiresAtDate = checkoutSession.expires_at
      ? new Date(checkoutSession.expires_at * 1000)
      : null;
    const claim = await claimVendorCheckoutSession(
      {
        applicationId,
        vendorId: String(vendor._id),
        subscriptionId: checkoutSubscription.id,
        expectedApplicationPaymentStatus: application.paymentStatus,
        expectedApplicationCheckoutSessionId:
          application.stripeCheckoutSessionId || null,
        expectedSubscriptionCheckoutSessionId:
          selectedSubscription.stripeCheckoutSessionId || null,
        checkoutSessionId: checkoutSession.id,
        applicationPatch: {
          paymentStatus: VENDOR_APPLICATION_PAYMENT_STATUS.PENDING,
          planSnapshot: application.planSnapshot,
          stripeCustomerId,
          stripeCheckoutSessionId: checkoutSession.id,
          checkoutExpiresAt: checkoutExpiresAtDate,
          lastError: null,
        },
        subscriptionPatch: {
          applicationId: application._id,
          status: VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
          occupiesActiveSlot: false,
          provider: "stripe",
          stripeCustomerId,
          stripeCheckoutSessionId: checkoutSession.id,
          stripePriceId,
          // The billing sync trusts `planSnapshot.stripePriceId` as the price
          // this subscription was sold at. A vendor-initiated checkout may be
          // the first place a price exists (the plan had none at apply time), so
          // record it here too — otherwise a paid vendor never activates.
          "planSnapshot.stripePriceId": stripePriceId,
          providerStatus: "checkout_open",
        },
        subscriptionRollbackPatch: {
          stripeCustomerId: selectedSubscription.stripeCustomerId || null,
          stripeCheckoutSessionId:
            selectedSubscription.stripeCheckoutSessionId || null,
          stripePriceId: selectedSubscription.stripePriceId || null,
          "planSnapshot.stripePriceId":
            selectedSubscription.planSnapshot?.stripePriceId || null,
          providerStatus: selectedSubscription.providerStatus || null,
        },
      },
      {
        updateSubscription: (filter, patch) =>
          VendorSubscription.updateOne(filter, { $set: patch }),
        updateApplication: (filter, patch) =>
          VendorApplication.updateOne(filter, { $set: patch }),
        rollbackSubscription: (filter, patch) =>
          VendorSubscription.updateOne(filter, { $set: patch }),
        readCurrentState: async () => {
          const [currentApplication, currentSubscription] =
            await Promise.all([
              VendorApplication.findById(applicationId)
                .select("status paymentStatus stripeCheckoutSessionId")
                .lean<{
                  status?: string;
                  paymentStatus?: string;
                  stripeCheckoutSessionId?: string | null;
                } | null>(),
              VendorSubscription.findById(checkoutSubscription.id)
                .select(
                  "status occupiesActiveSlot stripeCheckoutSessionId",
                )
                .lean<{
                  status?: string;
                  occupiesActiveSlot?: boolean;
                  stripeCheckoutSessionId?: string | null;
                } | null>(),
            ]);
          return {
            applicationStatus: currentApplication?.status || null,
            applicationPaymentStatus:
              currentApplication?.paymentStatus || null,
            applicationCheckoutSessionId:
              currentApplication?.stripeCheckoutSessionId || null,
            subscriptionStatus: currentSubscription?.status || null,
            subscriptionOccupiesActiveSlot: Boolean(
              currentSubscription?.occupiesActiveSlot,
            ),
            subscriptionCheckoutSessionId:
              currentSubscription?.stripeCheckoutSessionId || null,
          };
        },
      },
    );

    const disposition = decideVendorCheckoutClaimDisposition(
      claim,
      checkoutSession.id,
    );
    if (disposition === "dashboard") {
      await expireOpenCheckoutSession(stripe, checkoutSession.id);
      return successResponse({
        url: `${origin}/${locale}/vendor/dashboard`,
        sessionId: claim.state.applicationCheckoutSessionId,
        applicationId,
        synchronized: true,
      });
    }
    if (disposition === "current_session") {
      const currentSessionId =
        claim.state.applicationCheckoutSessionId as string;
      const currentUrl = await reusableCheckoutUrl(
        stripe,
        currentSessionId,
        applicationId,
        checkoutSubscription.id,
      );
      if (currentUrl) {
        if (currentSessionId !== checkoutSession.id) {
          await expireOpenCheckoutSession(stripe, checkoutSession.id);
        }
        return successResponse({
          url: currentUrl,
          sessionId: currentSessionId,
          applicationId,
        });
      }
    }
    if (disposition !== "new_session") {
      await expireOpenCheckoutSession(stripe, checkoutSession.id);
      throw new ConflictError(
        "Vendor billing changed while Checkout was opening. Refresh and try again.",
      );
    }

    await Vendor.updateOne(
      {
        _id: vendor._id,
        stripeCustomerId: vendor.stripeCustomerId || null,
      },
      { $set: { stripeCustomerId } },
    );

    return successResponse({
      url: checkoutSession.url,
      sessionId: checkoutSession.id,
      applicationId,
      paymentDueAt: application.paymentDueAt,
    });
  } catch (error) {
    console.error("Vendor application checkout error:", error);
    return handleApiError(error);
  }
}
