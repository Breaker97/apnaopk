/**
 * One-shot (pay-per-period) subscription payments — the non-Stripe half of
 * vendor plan billing, and the missing counterpart to the Stripe sync's
 * activation block (lib/vendor-billing-sync.ts). Stripe subscriptions keep
 * their native recurring flow untouched; every other gateway (and the
 * admin's offline "record payment" action) pays one period at a time
 * through a PlatformPayment and lands here to advance the local clock.
 *
 * The local clock is everything: once currentPeriodEnd is set, the existing
 * non-Stripe dunning machinery (decideDunningTransition + the hourly
 * reconciler) handles lapse → past_due → grace → expiry with no further
 * provider awareness.
 */

import {
  Vendor,
  VendorApplication,
  VendorSubscription,
  VendorSubscriptionPayment,
} from "@/models";
import type { IPlatformPayment } from "@/models/platformPayment.model";
import type { VendorSubscriptionPaymentProvider } from "@/models/vendorSubscriptionPayment.model";
import { getSettings } from "@/models/settings.model";
import { resolveVendorCommission } from "@/lib/vendors/vendor-commission";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  toStripeAmount,
} from "@/lib/payments/stripe";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import {
  VENDOR_APPLICATION_PAYMENT_STATUS,
  VENDOR_BILLING_INTERVAL,
  VENDOR_STATUS,
  VENDOR_SUBSCRIPTION_STATUS,
} from "@/config/app.config";
import type {
  BillingSyncResult,
  BillingTransitionNotification,
} from "@/lib/vendors/vendor-billing-sync";
import { dispatchVendorBillingNotifications } from "@/lib/vendors/vendor-billing-notifications";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { ensureVendorOwnerRole } from "@/lib/access/user-role";

function addBillingInterval(from: Date, interval: string): Date {
  const next = new Date(from);
  if (interval === VENDOR_BILLING_INTERVAL.YEARLY) {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

function providerInvoiceIdFor(
  payment: IPlatformPayment,
  subscriptionId: string,
  periodStart: Date,
): string {
  // Prefer the gateway's own transaction id (stable + externally auditable);
  // fall back to a locally-minted id that keeps the one-row-per-period
  // uniqueness of the {provider, providerInvoiceId} index.
  return (
    payment.stripePaymentIntentId ||
    payment.paypalCaptureId ||
    payment.razorpayPaymentId ||
    payment.paystackTransactionId ||
    payment.pesapalOrderTrackingId ||
    payment.iotecTransactionId ||
    payment.orangeMoneyTxnId ||
    payment.mtnMomoTransactionId ||
    `vsub_${subscriptionId}_${Math.floor(periodStart.getTime() / 1000)}`
  );
}

/**
 * The Stripe subscription a one-shot payment is about to supersede, or null.
 *
 * Pure so the condition can be tested without a database: it is the trigger
 * for cancelling a live recurring subscription, and getting it wrong in either
 * direction is expensive — too eager cancels a Stripe vendor who was only
 * renewing, too shy leaves the vendor being billed twice.
 *
 * `sub_` is required because a row that has already been through here carries
 * our own "VSUB-…" reference in the same field; only Stripe's own id may be
 * handed to Stripe.
 */
export function supersededStripeSubscriptionRef(subscription: {
  provider?: string | null;
  paymentProviderRef?: string | null;
}): string | null {
  if (subscription.provider !== "stripe") return null;
  const ref = subscription.paymentProviderRef;
  return typeof ref === "string" && ref.startsWith("sub_") ? ref : null;
}

/**
 * Stop the Stripe subscription a vendor has just switched away from.
 *
 * Ordering is the whole safety argument here, and it runs AFTER the local flip:
 * once `provider` is no longer "stripe" this row is invisible to every Stripe
 * path — findContext's three lookups, the hourly reconciliation query and the
 * webhook processors all scope themselves to `provider: "stripe"` — so the
 * `customer.subscription.deleted` this cancellation itself emits cannot come
 * back and mark the row ended. Cancelling first and flipping second would open
 * exactly that window, and the vendor would lose their store to a webhook
 * describing a subscription they had deliberately replaced.
 *
 * A failure is recorded rather than thrown. The vendor's money has already
 * landed and the period is already theirs; the worst case left behind is a
 * Stripe subscription that bills once more, which is a refund conversation
 * rather than a deactivated store — and unwinding the payment to avoid it
 * would be the far greater harm.
 */
async function releaseSupersededStripeSubscription(
  localSubscriptionId: string,
  stripeSubscriptionId: string,
): Promise<void> {
  try {
    const settings = await getSettings();
    const secretKey = resolveStripeCredentials(
      settings.payment?.stripe,
    ).secretKey;
    if (!isStripeSecretKeyConfigured(secretKey)) {
      throw new Error("Stripe is not configured");
    }
    const { releaseStripeVendorSubscription } = await import(
      "@/lib/vendors/vendor-stripe-adapter"
    );
    await releaseStripeVendorSubscription(
      getStripeForSecretKey(secretKey as string),
      stripeSubscriptionId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Failed to release superseded Stripe subscription ${stripeSubscriptionId} for vendor subscription ${localSubscriptionId}`,
      error,
    );
    await VendorSubscription.updateOne(
      { _id: localSubscriptionId },
      {
        $set: {
          providerStatus: "stripe_release_failed",
          lastReconcileError: `Superseded Stripe subscription ${stripeSubscriptionId} could not be cancelled: ${message}`,
        },
      },
    ).catch(() => undefined);
  }
}

/**
 * Advance a subscription by one paid period. Idempotent per payment: the
 * unique {provider, providerInvoiceId} ledger row is the replay guard (the
 * caller, finalizePlatformPayment, already guards the payment itself).
 *
 * Handles both the initial application payment (applicationId present →
 * marks it paid, activates the vendor) and later renewals (period extends
 * from the previous currentPeriodEnd, so renewing early loses no days).
 */
async function recordOneShotSubscriptionPayment(
  payment: IPlatformPayment,
): Promise<void> {
  if (!payment.subscriptionId) {
    console.error(
      `Subscription payment ${payment._id} has no subscriptionId — cannot record`,
    );
    return;
  }
  const subscriptionId = String(payment.subscriptionId);
  const subscription = await VendorSubscription.findById(subscriptionId);
  if (!subscription) {
    console.error(
      `Subscription payment ${payment._id} references a missing subscription ${subscriptionId}`,
    );
    return;
  }

  const now = new Date();
  // Read before the $set below overwrites `provider` and `paymentProviderRef`:
  // a vendor moving off Stripe pays their next period through the new gateway,
  // and the Stripe subscription that would otherwise keep billing them has to
  // be released once that payment is durable.
  const supersededStripeRef = supersededStripeSubscriptionRef(subscription);
  const interval =
    subscription.planSnapshot?.billingInterval ||
    VENDOR_BILLING_INTERVAL.MONTHLY;
  // The purchased period is computed exactly once per payment and CAS-stamped
  // onto the attempt row; re-runs (finalize's crash-repair path) reuse the
  // stored period, so the clock write below is a pure idempotent $set and can
  // never double-advance. Renewing before expiry extends from the current
  // period end; a lapsed or first-time subscription starts now.
  const { PlatformPayment } = await import("@/models");
  if (!payment.periodStart || !payment.periodEnd) {
    const computedStart =
      subscription.status === VENDOR_SUBSCRIPTION_STATUS.ACTIVE &&
      subscription.currentPeriodEnd &&
      subscription.currentPeriodEnd > now
        ? subscription.currentPeriodEnd
        : now;
    await PlatformPayment.updateOne(
      { _id: payment._id, periodStart: null },
      {
        $set: {
          periodStart: computedStart,
          periodEnd: addBillingInterval(computedStart, interval),
        },
      },
    );
    const stamped = await PlatformPayment.findById(payment._id)
      .select("periodStart periodEnd")
      .lean<{ periodStart?: Date | null; periodEnd?: Date | null } | null>();
    payment.periodStart = stamped?.periodStart ?? computedStart;
    payment.periodEnd =
      stamped?.periodEnd ?? addBillingInterval(computedStart, interval);
  }
  const periodStart = payment.periodStart as Date;
  const periodEnd = payment.periodEnd as Date;

  // The partial-unique {vendorId, occupiesActiveSlot} index allows one live
  // row per vendor — retire any rival before claiming the slot.
  await VendorSubscription.updateMany(
    {
      vendorId: subscription.vendorId,
      _id: { $ne: subscription._id },
      occupiesActiveSlot: true,
    },
    {
      $set: {
        status: VENDOR_SUBSCRIPTION_STATUS.CANCELLED,
        occupiesActiveSlot: false,
      },
    },
  );

  await VendorSubscription.updateOne(
    { _id: subscription._id },
    {
      $set: {
        status: VENDOR_SUBSCRIPTION_STATUS.ACTIVE,
        occupiesActiveSlot: true,
        provider: payment.provider,
        paymentProviderRef: payment.reference,
        providerStatus: "one_shot_paid",
        // Self-heal the snapshot from what was actually collected. Rows written
        // before the currency fix carry a stale "USD" that the renew route
        // would otherwise keep re-reading for every future period.
        "planSnapshot.currency": payment.currency,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        lastPaymentAt: now,
        firstPaymentFailedAt: null,
        failedInvoiceId: null,
        gracePeriodEnd: null,
        retryCount: 0,
        nextRetryAt: null,
        // Pointers that describe the Stripe subscription being replaced. They
        // are cleared with the same write that flips the provider, so the row
        // never sits in a state where it looks half-Stripe. `stripeCustomerId`
        // deliberately survives: it is the vendor's billing identity with
        // Stripe, not this subscription's, and it is what lets them move back.
        ...(supersededStripeRef
          ? {
              stripeSubscriptionItemId: null,
              stripeLatestInvoiceId: null,
              stripeScheduleId: null,
              pendingStripeInvoiceId: null,
            }
          : {}),
      },
    },
  );

  if (supersededStripeRef) {
    await releaseSupersededStripeSubscription(
      subscriptionId,
      supersededStripeRef,
    );
  }

  // One ledger row per paid period; upsert keyed the same way the Stripe
  // invoice sync keys its rows, so replays cannot double-record.
  const providerInvoiceId = providerInvoiceIdFor(
    payment,
    subscriptionId,
    periodStart,
  );
  await VendorSubscriptionPayment.updateOne(
    {
      provider: payment.provider as VendorSubscriptionPaymentProvider,
      providerInvoiceId,
    },
    {
      $set: {
        vendorId: subscription.vendorId,
        subscriptionId: subscription._id,
        applicationId: payment.applicationId ?? null,
        providerSubscriptionId: subscriptionId,
        providerPaymentIntentId: payment.stripePaymentIntentId ?? null,
        status: "paid",
        // These three columns are the provider's financial record, held in
        // Stripe's smallest currency unit so a one-shot row and a Stripe
        // invoice row can be read the same way. PlatformPayment.amount is
        // MAJOR units (it is what the gateway was asked to collect), so it has
        // to be converted on the way in — storing it raw made every non-Stripe
        // invoice read 100x low in two-decimal currencies once the reader
        // applied fromStripeAmount(). Zero-decimal stores (UGX) hid the bug.
        amountDue: toStripeAmount(payment.amount, payment.currency),
        amountPaid: toStripeAmount(payment.amount, payment.currency),
        amountRefunded: 0,
        currency: payment.currency,
        periodStart,
        periodEnd,
        attemptCount: 1,
        paidAt: payment.paidAt ?? now,
        providerCreatedAt: payment.createdAt ?? now,
        providerStateUpdatedAt: now,
      },
    },
    { upsert: true },
  );

  const isInitial = Boolean(payment.applicationId);
  if (isInitial) {
    const application = await VendorApplication.findOneAndUpdate(
      { _id: payment.applicationId },
      {
        $set: {
          paymentStatus: VENDOR_APPLICATION_PAYMENT_STATUS.PAID,
          paymentCompletedAt: now,
          paymentExpiredAt: null,
          setupAccessExpiredAt: null,
          trialEndedAt: null,
          lastError: null,
        },
      },
      { new: false },
    )
      .select("stripeCheckoutSessionId")
      .lean<{ stripeCheckoutSessionId?: string | null } | null>();

    // Cross-rail guard: the vendor may have opened a Stripe subscription
    // Checkout before paying this one-shot charge. That session stays open
    // for 24h and completing it would start a SECOND (recurring) billing —
    // expire it now that the first period is paid another way.
    if (application?.stripeCheckoutSessionId) {
      try {
        const settings = await getSettings();
        const { assertStripeBillingReady } = await import(
          "@/lib/vendors/vendor-plan-stripe"
        );
        const { getStripeForSecretKey } = await import("@/lib/payments/stripe");
        const { expireSupersededVendorCheckoutSession } = await import(
          "@/lib/vendors/vendor-checkout-binding"
        );
        const stripe = getStripeForSecretKey(assertStripeBillingReady(settings));
        await expireSupersededVendorCheckoutSession(
          {
            retrieve: (id) => stripe.checkout.sessions.retrieve(id),
            expire: async (id) => {
              await stripe.checkout.sessions.expire(id);
            },
          },
          application.stripeCheckoutSessionId,
        );
      } catch {
        // Stripe not configured or the session already closed — nothing to
        // expire; the claim CAS on the Stripe side still refuses a stale
        // completion against a paid application.
      }
    }
  }

  // Same access projection as the Stripe sync's activateVendor: approved,
  // store on, plan + commission snapshot projected onto the vendor.
  //
  // The fallback is the configured default, NOT zero. `commissionRateSnapshot`
  // is `required` on the schema so it should always be here, but a row written
  // before the field existed — or straight into the database — would otherwise
  // put a vendor on 0% commission permanently, and nothing downstream would
  // ever report it: a free vendor looks exactly like a vendor on a 0% plan.
  // Falling back to what the platform charges everyone else is the failure a
  // merchant complains about, rather than one only an audit finds.
  const commission =
    typeof subscription.commissionRateSnapshot === "number"
      ? subscription.commissionRateSnapshot
      : resolveVendorCommission(null, null, await getSettings());
  await Vendor.updateOne(
    { _id: subscription.vendorId },
    {
      $set: {
        status: VENDOR_STATUS.APPROVED,
        storeActive: true,
        planId: subscription.planId,
        commission,
        commissionSource: "plan",
      },
    },
  );

  // ...and the same owner-role repair the Stripe sync does, for the same
  // reason: a store that comes back through the one-shot rail has to bring its
  // owner's dashboard access back with it. Without this the merchant pays,
  // watches their store go live, and still lands on the customer account page.
  // See `ensureVendorOwnerRole` — idempotent, and it skips admin/staff owners.
  const vendorOwner = await Vendor.findById(subscription.vendorId)
    .select("userId")
    .lean<{ userId?: unknown } | null>();
  await ensureVendorOwnerRole(vendorOwner?.userId).catch((error) => {
    console.error("Failed to sync vendor owner role on activation:", error);
  });

  const notifications: BillingTransitionNotification[] = [
    {
      type: "payment_confirmed",
      key: `platform:${String(payment._id)}:paid`,
    },
    ...(isInitial
      ? [
          {
            type: "plan_activated" as const,
            key: `subscription:${subscriptionId}:activated`,
          },
        ]
      : []),
  ];
  const result: BillingSyncResult = {
    subscriptionId,
    applicationId: payment.applicationId ? String(payment.applicationId) : null,
    vendorId: String(subscription.vendorId),
    activated: true,
    deactivated: false,
    reason: "activated",
    notifications,
  };
  const settings = await getSettings();
  await dispatchVendorBillingNotifications(result, settings);
  revalidateProductContent();
}

/** finalizePlatformPayment's dispatch target for kind "subscription". */
export async function finalizeSubscriptionPlatformPayment(
  payment: IPlatformPayment,
): Promise<void> {
  await recordOneShotSubscriptionPayment(payment);
}

/**
 * The admin "record offline payment / extend period" lever — also the
 * comp/extend gap-filler. Creates a paid manual PlatformPayment and runs the
 * same period-advance path a gateway payment takes.
 */
export async function recordManualSubscriptionPayment(input: {
  subscriptionId: string;
  adminUserId: string;
  note?: string;
}): Promise<{ periodEnd: Date | null }> {
  const subscription = await VendorSubscription.findById(input.subscriptionId)
    .select("vendorId planId planSnapshot status applicationId")
    .lean<{
      _id: unknown;
      vendorId?: unknown;
      planId?: unknown;
      status?: string;
      applicationId?: unknown;
      planSnapshot?: { price?: number; currency?: string } | null;
    } | null>();
  if (!subscription) return { periodEnd: null };

  const settings = await getSettings();
  const currency = (
    subscription.planSnapshot?.currency ||
    settings.general?.defaultCurrency ||
    "USD"
  ).toUpperCase();

  // An INCOMPLETE row is a vendor who has never paid a period — the offline
  // lever is covering their FIRST one, so the payment must carry the
  // application id that marks the onboarding invitation paid. Renewals must
  // NOT carry it: that would re-stamp paymentCompletedAt on a settled record.
  const isInitialPeriod =
    subscription.status === VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE &&
    Boolean(subscription.applicationId);

  const { createPlatformPaymentAttempt, finalizePlatformPayment } =
    await import("@/lib/payments/platform-payments");
  const payment = await createPlatformPaymentAttempt({
    kind: "subscription",
    subscriptionId: input.subscriptionId,
    applicationId: isInitialPeriod
      ? String(subscription.applicationId)
      : undefined,
    planId: subscription.planId ? String(subscription.planId) : undefined,
    vendorId: String(subscription.vendorId),
    userId: input.adminUserId,
    provider: "manual",
    amount: subscription.planSnapshot?.price ?? 0,
    currency,
  });
  await finalizePlatformPayment(payment, {});

  const fresh = await VendorSubscription.findById(input.subscriptionId)
    .select("currentPeriodEnd")
    .lean<{ currentPeriodEnd?: Date | null } | null>();
  return { periodEnd: fresh?.currentPeriodEnd ?? null };
}

/**
 * How far ahead of the period end a renewal counts as "due soon". The cron
 * reminder and the dashboard CTA share it: the email tells the vendor to renew
 * from their dashboard, so the button has to be there when the email lands.
 */
export const RENEWAL_REMINDER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Renewal-reminder sweep for one-shot providers (called from the vendor
 * subscriptions cron). Stripe rows renew themselves and are excluded;
 * everything else with a real local period clock — including "manual" rows an
 * admin extended offline — gets a renewal_due nudge inside the reminder
 * window, deduped per period via the notificationKeys claim.
 *
 * A running FREE TRIAL is swept the same way, off `trialEnd` instead of
 * `currentPeriodEnd`. It matters more here than for a renewal: a trial vendor
 * has never entered a payment method, so without this the first they hear of
 * the charge is their store going dark.
 */
export async function remindDueOneShotRenewals(
  limit = 100,
  now = new Date(),
  windowMs = RENEWAL_REMINDER_WINDOW_MS,
): Promise<{ scanned: number; reminded: number }> {
  const windowEnd = new Date(now.getTime() + windowMs);
  const dueRows = await VendorSubscription.find({
    // Everything with a real local clock except Stripe (renews itself).
    // "manual" rows are included on purpose: an admin recording an offline
    // payment flips the provider to manual, and that vendor still needs the
    // renewal nudge (the renew CTA lets them pay through a gateway).
    provider: { $ne: "stripe" },
    // A vendor mid-handover to Stripe has a card on file that charges the day
    // this period ends. Telling them to go and pay would be asking for the
    // money twice.
    stripeTakeoverSubscriptionId: null,
    occupiesActiveSlot: true,
    "planSnapshot.billingInterval": { $ne: VENDOR_BILLING_INTERVAL.NONE },
    "planSnapshot.price": { $gt: 0 },
    $or: [
      {
        status: VENDOR_SUBSCRIPTION_STATUS.ACTIVE,
        currentPeriodEnd: { $gt: now, $lte: windowEnd },
      },
      {
        status: VENDOR_SUBSCRIPTION_STATUS.TRIALING,
        trialEnd: { $gt: now, $lte: windowEnd },
      },
    ],
  })
    .sort({ currentPeriodEnd: 1 })
    .limit(limit)
    .select("vendorId applicationId status currentPeriodEnd trialEnd")
    .lean<
      Array<{
        _id: unknown;
        vendorId?: unknown;
        applicationId?: unknown;
        status?: string;
        currentPeriodEnd?: Date | null;
        trialEnd?: Date | null;
      }>
    >();

  let reminded = 0;
  const settings = await getSettings();
  for (const row of dueRows) {
    const isTrial = row.status === VENDOR_SUBSCRIPTION_STATUS.TRIALING;
    const deadline = isTrial ? row.trialEnd : row.currentPeriodEnd;
    const periodEpoch = deadline ? Math.floor(deadline.getTime() / 1000) : 0;
    const type = isTrial ? "trial_ending" : "renewal_due";
    const result: BillingSyncResult = {
      subscriptionId: String(row._id),
      applicationId: row.applicationId ? String(row.applicationId) : null,
      vendorId: row.vendorId ? String(row.vendorId) : null,
      activated: false,
      deactivated: false,
      reason: "provider_updated",
      notifications: [
        {
          type,
          // Keyed per period end so each cycle reminds exactly once.
          key: `subscription:${String(row._id)}:${type}:${periodEpoch}`,
        },
      ],
    };
    try {
      await dispatchVendorBillingNotifications(result, settings);
      reminded += 1;
    } catch (error) {
      console.error("Failed to send renewal reminder", row._id, error);
    }
  }

  return { scanned: dueRows.length, reminded };
}
