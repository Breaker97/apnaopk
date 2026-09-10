import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { reconcileDueSubscriptions } from "@/lib/vendors/vendor-plans";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { reconcileVendorPaymentInvitations } from "@/lib/vendors/vendor-payment-invitations";
import { getSettings } from "@/models/settings.model";
import { reconcileStripeVendorSubscriptions } from "@/lib/vendors/vendor-billing-reconciliation";
import { remindDueOneShotRenewals } from "@/lib/vendors/vendor-subscription-payments";
import { sweepPendingStripeTakeovers } from "@/lib/vendors/vendor-stripe-takeover";
import { withCronRun } from "@/lib/cron/health";

/**
 * Periodic vendor-subscription reconciliation. Advances the dunning state
 * machine (enter grace, retry, expire) for subscriptions whose lifecycle clock
 * has passed, so a lapsed vendor is reconciled even if they never open their
 * dashboard — closing the read-time-only gap of getEffectiveSubscription.
 *
 * Guarded by CRON_SECRET, mirroring /api/cron/email-deliveries.
 */
export const GET = withCronRun("vendor-subscriptions", async (request) => {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  await connectDB();
  const settings = await getSettings();
  // Takeovers settle FIRST, before the dunning sweep runs. A vendor mid-handover
  // is on the one-shot clock with a Stripe subscription charging the moment it
  // runs out, so promoting them here means the same run's dunning pass sees an
  // active Stripe row rather than a period that looks unpaid.
  const stripeTakeovers = await sweepPendingStripeTakeovers(settings, 100);
  const [subscriptions, stripeBilling, paymentInvitations, renewalReminders] =
    await Promise.all([
      reconcileDueSubscriptions(100),
      reconcileStripeVendorSubscriptions(settings, 100),
      reconcileVendorPaymentInvitations(settings, 100),
      // One-shot (non-Stripe) subscriptions have no gateway auto-renew — nudge
      // vendors inside the reminder window, deduped per period.
      remindDueOneShotRenewals(100),
    ]);

  // If any store was deactivated this run (a paid plan lapsed), bust the
  // storefront caches so the now-hidden stores drop out immediately instead of
  // waiting out the approved-vendor list's 60s revalidate window. Done here in
  // the cron's request context — revalidateTag is unsafe from a plain read
  // path, which is why the reconcile function only reports the count.
  if (
    subscriptions.deactivated > 0 ||
    stripeBilling.deactivated > 0 ||
    paymentInvitations.expired > 0
  ) {
    revalidateProductContent();
  }

  return NextResponse.json({
    success: true,
    data: {
      subscriptions,
      stripeBilling,
      stripeTakeovers,
      paymentInvitations,
      renewalReminders,
    },
  });
});
