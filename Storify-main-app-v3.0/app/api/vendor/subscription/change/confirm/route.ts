import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { VendorSubscription } from "@/models";
import { getSettings } from "@/models/settings.model";
import { assertStripeBillingReady } from "@/lib/vendors/vendor-plan-stripe";
import { getStripeForSecretKey } from "@/lib/payments/stripe";
import { confirmStripeVendorUpgrade } from "@/lib/vendors/vendor-stripe-adapter";
import { synchronizeVendorBilling } from "@/lib/vendors/vendor-billing-sync";
import { dispatchVendorBillingNotifications } from "@/lib/vendors/vendor-billing-notifications";

export const POST = withApi(
  {
    auth: "user",
    rateLimit: {
      action: "vendor:subscription:upgradeConfirm",
      preset: "moderate",
    },
  },
  async ({ session }) => {
    const vendor = await requireApprovedVendorByUserId(session.user.id);
    const subscription = await VendorSubscription.findOne({
      vendorId: vendor._id,
      provider: "stripe",
      status: "active",
      pendingChangeType: "upgrade",
      pendingChangeStatus: "awaiting_vendor",
    }).sort({ createdAt: -1 });
    if (
      !subscription?.paymentProviderRef ||
      !subscription.stripeSubscriptionItemId ||
      !subscription.pendingPlanId ||
      !subscription.pendingPlanSnapshot?.stripePriceId
    ) {
      throw new ValidationError(
        "No vendor-confirmable paid upgrade is currently staged",
      );
    }

    const settings = await getSettings();
    const stripe = getStripeForSecretKey(assertStripeBillingReady(settings));
    const snapshot = await confirmStripeVendorUpgrade(stripe, {
      subscriptionId: subscription.paymentProviderRef,
      subscriptionItemId: subscription.stripeSubscriptionItemId,
      targetPriceId: subscription.pendingPlanSnapshot.stripePriceId,
      targetPlanId: String(subscription.pendingPlanId),
      applicationId: subscription.applicationId
        ? String(subscription.applicationId)
        : null,
      vendorId: String(vendor._id),
      userId: session.user.id,
    });
    subscription.pendingChangeStatus = "awaiting_payment";
    subscription.pendingStripeInvoiceId = snapshot.invoice?.id ?? null;
    subscription.lastReconcileError = null;
    await subscription.save();

    const result = await synchronizeVendorBilling(snapshot, {
      eventType: "vendor.upgrade_confirmed",
    });
    await dispatchVendorBillingNotifications(result, settings);

    let paymentUrl: string | null = null;
    if (snapshot.invoice && snapshot.invoice.status !== "paid") {
      const invoice = await stripe.invoices.retrieve(snapshot.invoice.id);
      paymentUrl =
        (invoice as unknown as { hosted_invoice_url?: string | null })
          .hosted_invoice_url ?? null;
    }

    return successResponse({
      subscriptionId: String(subscription._id),
      status:
        result.reason === "activated" ? "applied" : "awaiting_payment",
      paymentUrl,
    });
  },
);
