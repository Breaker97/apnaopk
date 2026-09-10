import type Stripe from "stripe";
import { Types } from "mongoose";
import {
  VendorApplication,
  VendorSubscription,
} from "@/models";
import {
  VENDOR_APPLICATION_PAYMENT_STATUS,
  VENDOR_APPLICATION_STATUS,
  VENDOR_SUBSCRIPTION_STATUS,
} from "@/config/app.config";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
} from "@/lib/payments/stripe";
import { getSettings, type ISettings } from "@/models/settings.model";
import type { IVendorApplication } from "@/models/vendorApplication.model";
import {
  normalizeStripeSubscription,
} from "@/lib/vendors/vendor-billing-state";
import {
  normalizeStripeInvoice,
  retrieveCheckoutBillingSnapshot,
  retrieveVendorBillingSnapshot,
  stripeObjectId,
  type VendorBillingSnapshot,
} from "@/lib/vendors/vendor-stripe-adapter";
import { synchronizeVendorBilling } from "@/lib/vendors/vendor-billing-sync";
import { dispatchVendorBillingNotifications } from "@/lib/vendors/vendor-billing-notifications";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { ValidationError } from "@/lib/api/errors";
import {
  resolveVendorCheckoutSubscriptionBinding,
  VENDOR_APPLICATION_CHECKOUT_KIND,
} from "@/lib/vendors/vendor-checkout-binding";

export { VENDOR_APPLICATION_CHECKOUT_KIND } from "@/lib/vendors/vendor-checkout-binding";

/** Exported for the takeover path, which resolves a pending handover from the
 *  same id but cannot reuse the processors above (they scope to
 *  `provider: "stripe"`, which a row awaiting takeover deliberately is not). */
export function subscriptionIdFromInvoice(
  invoice: Stripe.Invoice,
): string | null {
  const raw = invoice as unknown as {
    subscription?: unknown;
    parent?: { subscription_details?: { subscription?: unknown } };
  };
  return (
    stripeObjectId(raw.subscription) ??
    stripeObjectId(raw.parent?.subscription_details?.subscription)
  );
}

export function isVendorApplicationCheckoutSession(
  session: Stripe.Checkout.Session,
): boolean {
  return session.metadata?.kind === VENDOR_APPLICATION_CHECKOUT_KIND;
}

async function synchronizeAndNotify(
  snapshot: VendorBillingSnapshot,
  settings: ISettings,
  eventType?: string,
) {
  const result = await synchronizeVendorBilling(snapshot, { eventType });
  await dispatchVendorBillingNotifications(result, settings);
  if (result.activated || result.deactivated) {
    revalidateProductContent();
  }
  return result;
}

export async function processVendorCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  stripe?: Stripe | null,
): Promise<boolean> {
  if (!isVendorApplicationCheckoutSession(session)) return false;

  const metadata = session.metadata || {};
  const applicationId = metadata.applicationId || "";
  if (!Types.ObjectId.isValid(applicationId)) {
    console.error(
      "Vendor checkout session missing valid applicationId",
      session.id,
    );
    return true;
  }

  const application = await VendorApplication.findById(applicationId);
  if (!application) {
    console.error(
      "Vendor checkout completed for missing application",
      applicationId,
    );
    return true;
  }
  if (
    (metadata.userId && String(application.userId) !== metadata.userId) ||
    (metadata.vendorId &&
      String(application.vendorId || "") !== metadata.vendorId) ||
    (metadata.planId &&
      String(application.planId || "") !== metadata.planId)
  ) {
    application.lastError = "Stripe Checkout metadata mismatch";
    await application.save();
    return true;
  }
  if (application.status !== VENDOR_APPLICATION_STATUS.APPROVED) {
    application.lastError =
      "Stripe Checkout completed before application approval";
    await application.save();
    return true;
  }

  const subscriptionId = stripeObjectId(session.subscription);
  const customerId = stripeObjectId(session.customer);
  const localSubscriptionId = metadata.localSubscriptionId || null;
  if (
    localSubscriptionId &&
    !Types.ObjectId.isValid(localSubscriptionId)
  ) {
    throw new ValidationError(
      "Vendor subscription billing record identifier is invalid",
    );
  }
  const checkoutSubscription =
    await resolveVendorCheckoutSubscriptionBinding(
      {
        applicationId,
        localSubscriptionId,
        checkoutSessionId: session.id,
        providerSubscriptionId: subscriptionId,
      },
      {
        async findByLocalSubscriptionId(id) {
          const row = await VendorSubscription.findOne({
            _id: id,
            provider: "stripe",
          })
            .select("_id applicationId")
            .lean<{ _id: unknown; applicationId?: unknown } | null>();
          return row
            ? {
                id: String(row._id),
                applicationId: row.applicationId
                  ? String(row.applicationId)
                  : null,
              }
            : null;
        },
        async findEstablishedBindings(
          checkoutSessionId,
          providerSubscriptionId,
          limit,
        ) {
          const references: Array<Record<string, unknown>> = [
            { stripeCheckoutSessionId: checkoutSessionId },
          ];
          if (providerSubscriptionId) {
            references.push({
              paymentProviderRef: providerSubscriptionId,
            });
          }
          const rows = await VendorSubscription.find({
            provider: "stripe",
            $or: references,
          })
            .limit(limit)
            .select("_id applicationId")
            .lean<Array<{ _id: unknown; applicationId?: unknown }>>();
          return rows.map((row) => ({
            id: String(row._id),
            applicationId: row.applicationId
              ? String(row.applicationId)
              : null,
          }));
        },
        async findIncompleteByApplicationId(id, limit) {
          const rows = await VendorSubscription.find({
            applicationId: id,
            provider: "stripe",
            status: VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
          })
            .sort({ createdAt: -1 })
            .limit(limit)
            .select("_id applicationId")
            .lean<Array<{ _id: unknown; applicationId?: unknown }>>();
          return rows.map((row) => ({
            id: String(row._id),
            applicationId: row.applicationId
              ? String(row.applicationId)
              : null,
          }));
        },
      },
    );

  await VendorApplication.updateOne(
    {
      _id: application._id,
      status: VENDOR_APPLICATION_STATUS.APPROVED,
      paymentStatus: {
        $ne: VENDOR_APPLICATION_PAYMENT_STATUS.PAID,
      },
    },
    {
      $set: {
        paymentStatus: VENDOR_APPLICATION_PAYMENT_STATUS.PENDING,
        stripeCheckoutSessionId: session.id,
        stripeCustomerId:
          customerId ?? application.stripeCustomerId ?? null,
        stripeSubscriptionId:
          subscriptionId ?? application.stripeSubscriptionId ?? null,
        lastError: null,
      },
    },
  );

  await VendorSubscription.updateOne(
    {
      _id: checkoutSubscription.id,
    },
    {
      $set: {
        provider: "stripe",
        paymentProviderRef: subscriptionId,
        stripeCustomerId: customerId,
        stripeCheckoutSessionId: session.id,
      },
    },
  );
  await VendorSubscription.updateOne(
    {
      _id: checkoutSubscription.id,
      status: VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
    },
    { $set: { providerStatus: "checkout_complete" } },
  );

  if (!stripe || !subscriptionId) return true;
  const snapshot = await retrieveCheckoutBillingSnapshot(stripe, session);
  if (!snapshot) return true;
  await synchronizeAndNotify(
    snapshot,
    await getSettings(),
    "checkout.session.completed",
  );
  return true;
}

export async function processVendorCheckoutSessionExpired(
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  if (!isVendorApplicationCheckoutSession(session)) return false;

  await VendorApplication.updateOne(
    {
      stripeCheckoutSessionId: session.id,
      status: VENDOR_APPLICATION_STATUS.APPROVED,
      paymentStatus: {
        $ne: VENDOR_APPLICATION_PAYMENT_STATUS.PAID,
      },
    },
    {
      $set: {
        paymentStatus: VENDOR_APPLICATION_PAYMENT_STATUS.FAILED,
        lastError: "Stripe Checkout session expired before payment completed",
      },
    },
  );
  await VendorSubscription.updateOne(
    {
      stripeCheckoutSessionId: session.id,
      status: VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
    },
    {
      $set: {
        occupiesActiveSlot: false,
        providerStatus: "checkout_expired",
      },
    },
  );
  return true;
}

function snapshotFromExpandedSubscription(
  subscription: Stripe.Subscription,
): VendorBillingSnapshot {
  const raw = subscription as unknown as { latest_invoice?: unknown };
  const expandedInvoice =
    raw.latest_invoice &&
    typeof raw.latest_invoice === "object" &&
    "id" in raw.latest_invoice
      ? (raw.latest_invoice as Stripe.Invoice)
      : null;
  return {
    subscription: normalizeStripeSubscription(subscription),
    invoice: expandedInvoice
      ? normalizeStripeInvoice(expandedInvoice)
      : null,
  };
}

export async function processVendorSubscriptionUpdated(
  subscription: Stripe.Subscription,
  settings: ISettings,
  stripe?: Stripe | null,
): Promise<boolean> {
  const snapshot = stripe
    ? await retrieveVendorBillingSnapshot(stripe, subscription.id)
    : snapshotFromExpandedSubscription(subscription);
  const result = await synchronizeAndNotify(
    snapshot,
    settings,
    `customer.subscription.${subscription.status}`,
  );
  return result.reason !== "not_found";
}

export async function processVendorInvoicePaid(
  invoice: Stripe.Invoice,
  settings: ISettings,
  stripe?: Stripe | null,
): Promise<boolean> {
  if (invoice.status !== "paid") return false;
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId || !stripe) return false;
  const snapshot = await retrieveVendorBillingSnapshot(
    stripe,
    subscriptionId,
    invoice.id,
  );
  const result = await synchronizeAndNotify(
    snapshot,
    settings,
    "invoice.paid",
  );
  return result.reason !== "not_found";
}

export async function processVendorInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  settings: ISettings,
  stripe?: Stripe | null,
): Promise<boolean> {
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId || !stripe) return false;
  const snapshot = await retrieveVendorBillingSnapshot(
    stripe,
    subscriptionId,
    invoice.id,
  );
  const result = await synchronizeAndNotify(
    snapshot,
    settings,
    "invoice.payment_failed",
  );
  return result.reason !== "not_found";
}

export async function verifyVendorCheckoutSession(
  sessionId: string,
  settings: ISettings,
  expectedUserId?: string,
): Promise<IVendorApplication | null> {
  const stripeSettings = settings.payment?.stripe;
  const secretKey = resolveStripeCredentials(stripeSettings).secretKey;
  if (!stripeSettings?.enabled || !isStripeSecretKeyConfigured(secretKey)) {
    return null;
  }

  const stripe = getStripeForSecretKey(secretKey);
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!isVendorApplicationCheckoutSession(session)) return null;
  if (expectedUserId && session.metadata?.userId !== expectedUserId) return null;

  if (session.status === "complete") {
    await processVendorCheckoutSessionCompleted(session, stripe);
  }

  const applicationId = session.metadata?.applicationId;
  return applicationId && Types.ObjectId.isValid(applicationId)
    ? VendorApplication.findById(applicationId)
    : null;
}

export async function cancelVendorApplicationBilling(
  application: IVendorApplication,
  settings: ISettings,
  options: { refund?: boolean } = {},
): Promise<void> {
  const subscriptionId = application.stripeSubscriptionId;
  if (!subscriptionId) return;

  const stripeSettings = settings.payment?.stripe;
  const secretKey = resolveStripeCredentials(stripeSettings).secretKey;
  if (!stripeSettings?.enabled || !isStripeSecretKeyConfigured(secretKey)) {
    application.lastError =
      "Stripe subscription cancellation failed because Stripe is not configured";
    await application.save();
    throw new ValidationError(application.lastError);
  }

  const stripe = getStripeForSecretKey(secretKey);
  let invoiceId = application.stripeLatestInvoiceId ?? null;

  try {
    const subscription = await stripe.subscriptions
      .cancel(subscriptionId, {
        invoice_now: false,
        prorate: false,
      })
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/already canceled|No such subscription/i.test(message)) return null;
        throw error;
      });
    invoiceId =
      invoiceId ??
      stripeObjectId(
        (
          subscription as unknown as {
            latest_invoice?: unknown;
          } | null
        )?.latest_invoice,
      );
  } catch (error) {
    application.lastError =
      error instanceof Error
        ? error.message
        : "Failed to cancel Stripe subscription";
    await application.save();
    throw error;
  }

  if (!options.refund || !invoiceId) {
    application.lastError = null;
    await application.save();
    return;
  }

  try {
    const invoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ["payments.data.payment.payment_intent"],
    });
    const paymentIntentId = normalizeStripeInvoice(invoice).paymentIntentId;
    if (!paymentIntentId) return;

    await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        metadata: {
          kind: "vendor_application_rejection_refund",
          applicationId: String(application._id),
          subscriptionId,
        },
      },
      {
        idempotencyKey: `vendor-application-reject-refund-${String(
          application._id,
        )}`,
      },
    );
    application.paymentStatus = VENDOR_APPLICATION_PAYMENT_STATUS.REFUNDED;
    application.refundedAt = new Date();
    application.lastError = null;
    await application.save();
  } catch (error) {
    application.lastError =
      error instanceof Error ? error.message : "Failed to refund Stripe payment";
    await application.save();
    throw error;
  }
}
