import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { getSettings } from "@/models/settings.model";
import { getEffectiveSubscription } from "@/lib/vendors/vendor-plans";
import { resolveVendorBillingProviders } from "@/lib/vendors/vendor-billing-providers";
import { VendorBillingContent } from "@/components/vendor/billing/vendor-billing-content";
import { VendorPlan } from "@/models";

/**
 * The vendor's plan billing screen.
 *
 * Until now the only way to pay a period was a banner: the past-due alert, or
 * the renewal-due alert inside its three-day window. A vendor who wanted to pay
 * early, see what they had already paid, or move their plan onto a different
 * gateway had nowhere to do it — the renew endpoint existed and was reachable
 * for roughly three days a month. This is the permanent surface for it.
 *
 * Gated on store settings rather than payouts: a plan sets the commission rate
 * and the product/staff ceilings, so it belongs to whoever configures the
 * store, not to whoever reconciles its payouts.
 */

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function VendorBillingPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled || !settings.vendorConfig?.plansEnabled) {
    notFound();
  }

  const access = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_STORE_SETTINGS],
  });

  // Reading lazily reconciles a lapsed period, so the status rendered here is
  // the same one the rest of the dashboard enforces rather than a stale row.
  const effective = await getEffectiveSubscription(String(access.vendor._id), {
    settings,
  });
  const subscription = effective.subscription as Record<string, unknown> | null;

  const planSnapshot = (subscription?.planSnapshot ?? null) as {
    name?: string;
    price?: number;
    currency?: string;
    billingInterval?: string;
  } | null;

  // The snapshot is the money contract and is what the renew route re-reads, so
  // it wins for anything billing-related. The live plan is only consulted for
  // the display name when a legacy row has no snapshot.
  const plan = subscription?.planId
    ? await VendorPlan.findById(String(subscription.planId))
        .select("name")
        .lean<{ name?: string } | null>()
    : null;

  const asIso = (value: unknown) =>
    value instanceof Date ? value.toISOString() : null;

  return (
    <VendorBillingContent
      locale={locale}
      paymentMethods={resolveVendorBillingProviders(settings)}
      subscription={
        subscription
          ? {
              status: effective.status,
              provider: (subscription.provider as string) ?? null,
              planName: planSnapshot?.name || plan?.name || null,
              price: planSnapshot?.price ?? null,
              billingInterval: planSnapshot?.billingInterval ?? null,
              currentPeriodStart: asIso(subscription.currentPeriodStart),
              currentPeriodEnd: asIso(subscription.currentPeriodEnd),
              // A trial has no paid period yet, so its end date is the only
              // date the vendor cares about: it is when their first charge
              // falls due and, unpaid, when the store closes.
              trialEnd: asIso(subscription.trialEnd),
              gracePeriodEnd: asIso(subscription.gracePeriodEnd),
              cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
              // Drives whether the switch-off-Stripe control is offered; the
              // renew route refuses the same states server-side.
              pendingChangeStatus:
                (subscription.pendingChangeStatus as string) ?? null,
              // A Stripe subscription already waiting to take over. The row is
              // still billed by the old gateway until it does, so this is shown
              // as a scheduled handover rather than as the current method.
              stripeTakeoverPending: Boolean(
                subscription.stripeTakeoverSubscriptionId,
              ),
              stripeTakeoverAt: asIso(subscription.stripeTakeoverAt),
              commissionRate:
                typeof subscription.commissionRateSnapshot === "number"
                  ? subscription.commissionRateSnapshot
                  : null,
            }
          : null
      }
    />
  );
}
