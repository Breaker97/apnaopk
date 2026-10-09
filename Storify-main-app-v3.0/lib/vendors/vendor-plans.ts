/**
 * Vendor subscription lifecycle — a lazy, read-time expiry clock with dunning.
 *
 * There is no cron. When a vendor's subscription is read via
 * `getEffectiveSubscription`, an elapsed trial or paid period is reconciled on
 * the spot. A trial that lapses expires immediately. A PAID period that ends
 * unpaid does NOT expire at once — it enters a dunning window (PAST_DUE) and is
 * retried up to SUBSCRIPTION_DUNNING.MAX_RETRIES across GRACE_PERIOD_DAYS before
 * finally expiring. This mirrors the WooCommerce Subscriptions "retry, hold,
 * then fail" model, but stays gateway-agnostic: the actual charge attempt is a
 * seam a real billing engine plugs in at each retry point. Here we only decide
 * WHEN to retry and WHEN to give up.
 *
 * On final expiry the active slot is freed and the vendor's commission reverts
 * to the settings/default rate — graceful degradation: the vendor keeps their
 * account, role, and store access; they lose the plan benefit until re-subscribe.
 *
 * Free plans (billingInterval "none") never lapse or dun. A PAID plan's free
 * trial is the one lapse that is not written off: it hands the vendor to the
 * initial-payment rail instead (see `endTrialAwaitingPayment`).
 */

import { Types } from "mongoose";
import { Vendor, VendorApplication, VendorSubscription } from "@/models";
import {
  BOOST_CANCEL_REASON,
  VENDOR_APPLICATION_PAYMENT_STATUS,
  VENDOR_STATUS,
  VENDOR_SUBSCRIPTION_STATUS,
  VENDOR_BILLING_INTERVAL,
  SUBSCRIPTION_DUNNING,
  STRIPE_TAKEOVER_SETTLE_WINDOW_MS,
} from "@/config/app.config";
import { getSettings } from "@/models/settings.model";
import { resolveVendorCommission } from "@/lib/vendors/vendor-commission";
import { subscriptionOccupiesSlot } from "@/models/vendorSubscription.model";
import type { ISettings } from "@/models/settings.model";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
} from "@/lib/payments/stripe";
import type { IVendorSubscription } from "@/models/vendorSubscription.model";
import type { Document } from "mongoose";

/** The outcome of evaluating a subscription against the clock. */
type DunningAction =
  | { kind: "none" }
  | { kind: "enterDunning"; gracePeriodEnd: Date; nextRetryAt: Date | null }
  | { kind: "retry"; retryCount: number; nextRetryAt: Date | null }
  | { kind: "expire" };

/** What a subscription row says about itself once its trial ran out unpaid. */
const TRIAL_ENDED_PROVIDER_STATUS = "trial_ended_awaiting_payment";

/** Add hours to a date without mutating the input. */
function addHours(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}

/** Add days to a date without mutating the input. */
function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Given the retry index just completed (0-based) and the grace deadline, compute
 * when the next retry is due — or null when no further retries fit before grace
 * ends. Backoff hours come from config; a retry that would fall on/after the
 * grace deadline is dropped (the next read past grace will expire instead).
 */
function nextRetryTime(
  attemptsDone: number,
  from: Date,
  gracePeriodEnd: Date,
): Date | null {
  const backoff = SUBSCRIPTION_DUNNING.RETRY_BACKOFF_HOURS;
  if (attemptsDone >= SUBSCRIPTION_DUNNING.MAX_RETRIES) return null;
  const hours = backoff[Math.min(attemptsDone, backoff.length - 1)];
  const next = addHours(from, hours);
  return next < gracePeriodEnd ? next : null;
}

/**
 * Pure dunning decision — no DB, unit-testable. Decides what should happen to a
 * subscription given the current time. Callers apply the returned action.
 *
 * - Free / non-recurring plans and non-lapsable states → { none }.
 * - A trialing sub past trialEnd → { expire } (no dunning on trials).
 * - An active sub past currentPeriodEnd → { enterDunning }.
 * - A past_due sub past its gracePeriodEnd (or out of retries) → { expire }.
 * - A past_due sub within grace whose nextRetryAt is due → { retry }.
 * - Otherwise → { none }.
 */
export function decideDunningTransition(
  sub: {
    provider?: string;
    status?: string;
    planSnapshot?: { billingInterval?: string };
    trialEnd?: Date | string | null;
    currentPeriodEnd?: Date | string | null;
    gracePeriodEnd?: Date | string | null;
    nextRetryAt?: Date | string | null;
    retryCount?: number;
    firstPaymentFailedAt?: Date | string | null;
    stripeTakeoverSubscriptionId?: string | null;
    stripeTakeoverAt?: Date | string | null;
  },
  now: Date,
): DunningAction {
  // Stripe owns recurring charge attempts and retry scheduling. Local reads
  // never infer a failed charge from a period boundary or advance fake retries;
  // the hourly provider reconciler mirrors Stripe and enforces fixed grace.
  if (sub.provider === "stripe") {
    return { kind: "none" };
  }

  // Free / non-recurring plans never lapse or dun.
  if (sub.planSnapshot?.billingInterval === VENDOR_BILLING_INTERVAL.NONE) {
    return { kind: "none" };
  }

  // A Stripe takeover is mid-handover: the vendor bought this period on the old
  // gateway and a Stripe subscription is about to charge for the next one. The
  // local clock runs out at exactly the moment Stripe collects, so without this
  // the period boundary would read as an unpaid lapse and tell a vendor whose
  // payment is landing that minute that their payment failed.
  //
  // Bounded deliberately: past the settle window the takeover is not coming, and
  // a subscription nobody is paying for must lapse like any other.
  if (sub.stripeTakeoverSubscriptionId && sub.stripeTakeoverAt) {
    const settleBy = new Date(
      new Date(sub.stripeTakeoverAt).getTime() +
        STRIPE_TAKEOVER_SETTLE_WINDOW_MS,
    );
    if (now < settleBy) return { kind: "none" };
  }

  // Trials expire directly (no payment to retry).
  if (
    sub.status === VENDOR_SUBSCRIPTION_STATUS.TRIALING &&
    sub.trialEnd &&
    new Date(sub.trialEnd) < now
  ) {
    return { kind: "expire" };
  }

  // A paid period that just ended → enter the dunning window.
  if (
    sub.status === VENDOR_SUBSCRIPTION_STATUS.ACTIVE &&
    sub.currentPeriodEnd &&
    new Date(sub.currentPeriodEnd) < now
  ) {
    const periodEnd = new Date(sub.currentPeriodEnd);
    const gracePeriodEnd = addDays(
      periodEnd,
      SUBSCRIPTION_DUNNING.GRACE_PERIOD_DAYS,
    );
    return {
      kind: "enterDunning",
      gracePeriodEnd,
      nextRetryAt: nextRetryTime(0, periodEnd, gracePeriodEnd),
    };
  }

  // Already in dunning: expire past the grace deadline or when retries run out.
  if (sub.status === VENDOR_SUBSCRIPTION_STATUS.PAST_DUE) {
    const grace = sub.gracePeriodEnd ? new Date(sub.gracePeriodEnd) : null;
    const retryCount = sub.retryCount ?? 0;

    // No grace deadline recorded (legacy past_due row) → expire, preserving the
    // old behavior for rows created before dunning existed.
    if (!grace) return { kind: "expire" };

    if (now >= grace || retryCount >= SUBSCRIPTION_DUNNING.MAX_RETRIES) {
      return { kind: "expire" };
    }

    // A retry is due → advance the schedule (a real engine attempts the charge
    // at this point; here we just move the clock forward).
    if (sub.nextRetryAt && new Date(sub.nextRetryAt) <= now) {
      const nextCount = retryCount + 1;
      return {
        kind: "retry",
        retryCount: nextCount,
        nextRetryAt: nextRetryTime(nextCount, now, grace),
      };
    }
  }

  return { kind: "none" };
}

/**
 * Hand a lapsed paid trial back to the initial-payment rail.
 *
 * Deliberately NOT the generic expiry below: that one writes the plan off
 * (planId cleared, commission reverted, subscription `expired`), which would
 * leave nothing for the vendor to pay for. Here the plan survives and only the
 * store closes, so the vendor's own "complete subscription payment" screen can
 * collect the first period on any enabled gateway.
 *
 * Every write is a compare-and-set, so a concurrent admin action — a
 * re-assignment, a suspension, a manually recorded payment — wins instead of
 * being clobbered by this read-time reconciliation.
 */
async function endTrialAwaitingPayment(
  vendorId: Types.ObjectId | string,
  sub: LeanVendorSubscription,
  now: Date,
): Promise<EffectiveSubscription> {
  // Only an approved, still-on-this-plan vendor is moved. A suspended or
  // rejected store must not be quietly promoted to "payment required".
  const vendorUpdate = await Vendor.updateOne(
    {
      _id: vendorId,
      planId: sub.planId,
      status: VENDOR_STATUS.APPROVED,
    },
    {
      $set: {
        status: VENDOR_STATUS.PAYMENT_REQUIRED,
        storeActive: false,
      },
    },
  );

  await VendorSubscription.updateOne(
    { _id: sub._id, status: VENDOR_SUBSCRIPTION_STATUS.TRIALING },
    {
      $set: {
        status: VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
        occupiesActiveSlot: subscriptionOccupiesSlot(
          VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
        ),
        // "stripe" is what every pending-first-payment row carries — the
        // one-shot gateways read the same rows — so this is the marker that
        // makes checkout find it, not a claim that Stripe is involved.
        provider: "stripe",
        providerStatus: TRIAL_ENDED_PROVIDER_STATUS,
        nextRetryAt: null,
        gracePeriodEnd: null,
      },
    },
  );

  if (sub.applicationId) {
    await VendorApplication.updateOne(
      {
        _id: sub.applicationId,
        paymentStatus: { $ne: VENDOR_APPLICATION_PAYMENT_STATUS.PAID },
      },
      {
        $set: {
          paymentStatus: VENDOR_APPLICATION_PAYMENT_STATUS.UNPAID,
          // No setup window this time: the trial WAS the window. A null due
          // date makes resolveVendorPaymentAccess return "payment_only", so
          // the dashboard stays shut until the period is paid.
          paymentDueAt: null,
          trialEndedAt: now,
        },
      },
    );
  }

  // Both of these follow the store actually closing, so they hang off the CAS:
  // a concurrent admin re-assignment (which turns the store back on) must not
  // have its boost rungs torn down or its vendor told to pay.
  if (vendorUpdate.modifiedCount > 0) {
    // A dark store renders a filler in every rung it booked, so those days are
    // dead inventory the marketplace cannot resell.
    const { releaseBoostInventoryForVendor } = await import(
      "@/lib/boosts/boosts"
    );
    await releaseBoostInventoryForVendor(
      vendorId,
      BOOST_CANCEL_REASON.VENDOR_INACTIVE,
    ).catch((error) =>
      console.error(
        "Failed to release boost inventory for a vendor whose trial ended",
        vendorId,
        error,
      ),
    );

    // Tell the vendor what closed their store and what reopens it. A trial
    // vendor never entered a payment method, so silence here reads as the
    // platform breaking rather than as a bill falling due. The notification key
    // is claimed on the subscription row, so this stays once-only even though
    // the enclosing reconciliation also runs from ordinary page reads.
    try {
      const [{ dispatchVendorBillingNotifications }, settings] =
        await Promise.all([
          import("@/lib/vendors/vendor-billing-notifications"),
          getSettings(),
        ]);
      await dispatchVendorBillingNotifications(
        {
          subscriptionId: String(sub._id),
          applicationId: sub.applicationId ? String(sub.applicationId) : null,
          vendorId: String(vendorId),
          activated: false,
          deactivated: true,
          reason: "access_revoked",
          notifications: [
            {
              type: "trial_ended",
              key: `subscription:${String(sub._id)}:trial_ended`,
            },
          ],
        },
        settings,
      );
    } catch (error) {
      console.error(
        "Failed to notify a vendor that their trial ended",
        vendorId,
        error,
      );
    }
  }

  return {
    subscription: {
      ...sub,
      status: VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
      providerStatus: TRIAL_ENDED_PROVIDER_STATUS,
    },
    status: VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
    justExpired: true,
    justEnteredDunning: false,
    justDeactivatedStore: vendorUpdate.modifiedCount > 0,
  };
}

interface EffectiveSubscription {
  /** The occupying subscription (lean), or null when the vendor has none. */
  subscription: Record<string, unknown> | null;
  /** Effective status after lazy reconciliation. */
  status: string | null;
  /** True when this call transitioned a lapsed subscription to expired. */
  justExpired: boolean;
  /** True when this call moved an active sub into the dunning window. */
  justEnteredDunning: boolean;
  /** True when this expiry also deactivated the store (a paid plan lapsed).
   * Signals callers (the cron) to revalidate storefront caches so the hidden
   * store drops out immediately instead of on the 60s cache window. */
  justDeactivatedStore: boolean;
}

/** A subscription as `lean()` returns it: the data fields, no document methods. */
type LeanVendorSubscription = Omit<IVendorSubscription, keyof Document> & {
  _id: Types.ObjectId;
};

/**
 * Read (and lazily reconcile) a vendor's current subscription, driving the
 * dunning state machine on the spot.
 * @param vendorId  the Vendor _id
 * @param opts.settings  pre-loaded settings (avoids a re-read)
 * @param opts.now       injectable clock for tests
 */
export async function getEffectiveSubscription(
  vendorId: Types.ObjectId | string,
  opts?: { settings?: ISettings; now?: Date },
): Promise<EffectiveSubscription> {
  const now = opts?.now ?? new Date();

  const sub = await VendorSubscription.findOne({
    vendorId,
    occupiesActiveSlot: true,
  }).lean<LeanVendorSubscription | null>();

  if (!sub) {
    return {
      subscription: null,
      status: null,
      justExpired: false,
      justEnteredDunning: false,
      justDeactivatedStore: false,
    };
  }

  const action = decideDunningTransition(sub, now);

  if (action.kind === "none") {
    return {
      subscription: sub,
      status: String(sub.status),
      justExpired: false,
      justEnteredDunning: false,
      justDeactivatedStore: false,
    };
  }

  // ---- Enter dunning: active period ended, hold the plan while retrying ----
  if (action.kind === "enterDunning") {
    // The vendor KEEPS the plan benefit during the grace window (past_due still
    // occupies the active slot), so commission is untouched here.
    await VendorSubscription.updateOne(
      { _id: sub._id, status: VENDOR_SUBSCRIPTION_STATUS.ACTIVE },
      {
        $set: {
          status: VENDOR_SUBSCRIPTION_STATUS.PAST_DUE,
          occupiesActiveSlot: subscriptionOccupiesSlot(
            VENDOR_SUBSCRIPTION_STATUS.PAST_DUE,
          ),
          gracePeriodEnd: action.gracePeriodEnd,
          nextRetryAt: action.nextRetryAt,
          retryCount: 0,
        },
      },
    );
    return {
      subscription: {
        ...sub,
        status: VENDOR_SUBSCRIPTION_STATUS.PAST_DUE,
        gracePeriodEnd: action.gracePeriodEnd,
        nextRetryAt: action.nextRetryAt,
      },
      status: VENDOR_SUBSCRIPTION_STATUS.PAST_DUE,
      justExpired: false,
      justEnteredDunning: true,
      justDeactivatedStore: false,
    };
  }

  // ---- Advance the retry schedule (still within grace) ----
  if (action.kind === "retry") {
    await VendorSubscription.updateOne(
      { _id: sub._id, status: VENDOR_SUBSCRIPTION_STATUS.PAST_DUE },
      {
        $set: {
          retryCount: action.retryCount,
          lastRetryAt: now,
          nextRetryAt: action.nextRetryAt,
        },
      },
    );
    return {
      subscription: {
        ...sub,
        retryCount: action.retryCount,
        nextRetryAt: action.nextRetryAt,
      },
      status: VENDOR_SUBSCRIPTION_STATUS.PAST_DUE,
      justExpired: false,
      justEnteredDunning: false,
      justDeactivatedStore: false,
    };
  }

  // ---- Expire: trial lapsed, or grace window exhausted ----

  // A paid plan's free trial running out is not a lapse to be written off — it
  // is the moment the deferred first payment falls due. The vendor keeps the
  // plan they chose (planId and commission stay put, inert while the store is
  // dark) and is handed to the SAME rail an unpaid new vendor uses: vendor back
  // to `payment_required`, the subscription row back to `incomplete` on the
  // pending-payment provider, and the application back to `unpaid` — one of the
  // statuses /api/vendor/applications/checkout accepts. Paying reactivates
  // through recordOneShotSubscriptionPayment / the Stripe sync, exactly as a
  // first payment does.
  if (
    sub.status === VENDOR_SUBSCRIPTION_STATUS.TRIALING &&
    sub.planSnapshot?.billingInterval &&
    sub.planSnapshot.billingInterval !== VENDOR_BILLING_INTERVAL.NONE
  ) {
    return endTrialAwaitingPayment(vendorId, sub, now);
  }

  const settings = opts?.settings ?? (await getSettings());

  // Money-safe + race-safe: revert the enforcement cache (Vendor.commission)
  // with a COMPARE-AND-SET that only applies while the vendor is still on THIS
  // plan. This closes the race where a concurrent admin re-assignment would be
  // clobbered by a stale read-modify-save, and the conditional $set avoids
  // full-document validation so a read never 500s on a legacy-invalid vendor.
  // A non-default vendor is implied here (the default store never holds a
  // subscription), so resolveVendorCommission(null, …) yields the settings/
  // default rate.
  // Deactivate the store ONLY when a PAID plan lapsed (payment failure). A free
  // trial ending must not deactivate a store. `status` is left untouched
  // ("approved") so the vendor keeps login + pending-order access; only
  // `storeActive` flips, which hides the store and blocks new orders. The
  // compare-and-set on planId keeps this race-safe against a concurrent
  // re-assignment (which sets storeActive back to true).
  const wasPaid =
    sub.planSnapshot?.billingInterval &&
    sub.planSnapshot.billingInterval !== VENDOR_BILLING_INTERVAL.NONE;

  const vendorUpdate = await Vendor.updateOne(
    { _id: vendorId, planId: sub.planId },
    {
      $set: {
        commission: resolveVendorCommission(null, null, settings),
        commissionSource: "default",
        planId: null,
        ...(wasPaid ? { storeActive: false } : {}),
      },
    },
  );

  // A deactivated store renders a filler in every rung it booked, so those days
  // are dead inventory the marketplace cannot resell. Guarded on the CAS above:
  // only the writer that actually flipped storeActive releases, so a concurrent
  // re-assignment does not tear down bookings it just restored.
  if (wasPaid && vendorUpdate.modifiedCount > 0) {
    const { releaseBoostInventoryForVendor } = await import("@/lib/boosts/boosts");
    await releaseBoostInventoryForVendor(
      vendorId,
      BOOST_CANCEL_REASON.VENDOR_INACTIVE,
    ).catch((error) =>
      console.error(
        "Failed to release boost inventory for lapsed vendor",
        vendorId,
        error,
      ),
    );
  }

  if (
    wasPaid &&
    sub.provider === "stripe" &&
    typeof sub.paymentProviderRef === "string" &&
    sub.paymentProviderRef
  ) {
    const secretKey = resolveStripeCredentials(
      settings.payment?.stripe,
    ).secretKey;
    if (!isStripeSecretKeyConfigured(secretKey)) {
      await VendorSubscription.updateOne(
        { _id: sub._id },
        { $set: { providerStatus: "cancellation_failed_missing_credentials" } },
      );
      return {
        subscription: {
          ...sub,
          providerStatus: "cancellation_failed_missing_credentials",
        },
        status: VENDOR_SUBSCRIPTION_STATUS.PAST_DUE,
        justExpired: false,
        justEnteredDunning: false,
        justDeactivatedStore: vendorUpdate.modifiedCount > 0,
      };
    }

    try {
      await getStripeForSecretKey(secretKey as string).subscriptions.cancel(
        sub.paymentProviderRef,
        { invoice_now: false, prorate: false },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already canceled|No such subscription/i.test(message)) {
        console.error("Failed to cancel expired vendor subscription", error);
        await VendorSubscription.updateOne(
          { _id: sub._id },
          { $set: { providerStatus: "cancellation_failed" } },
        );
        return {
          subscription: {
            ...sub,
            providerStatus: "cancellation_failed",
          },
          status: VENDOR_SUBSCRIPTION_STATUS.PAST_DUE,
          justExpired: false,
          justEnteredDunning: false,
          justDeactivatedStore: vendorUpdate.modifiedCount > 0,
        };
      }
    }
  }

  await VendorSubscription.updateOne(
    { _id: sub._id },
    {
      $set: {
        status: VENDOR_SUBSCRIPTION_STATUS.EXPIRED,
        occupiesActiveSlot: subscriptionOccupiesSlot(
          VENDOR_SUBSCRIPTION_STATUS.EXPIRED,
        ),
        nextRetryAt: null,
      },
    },
  );

  return {
    subscription: { ...sub, status: VENDOR_SUBSCRIPTION_STATUS.EXPIRED },
    status: VENDOR_SUBSCRIPTION_STATUS.EXPIRED,
    justExpired: true,
    justEnteredDunning: false,
    justDeactivatedStore: vendorUpdate.modifiedCount > 0,
  };
}

interface ReconcileSummary {
  /** Candidate subscriptions whose clock had passed and were re-evaluated. */
  scanned: number;
  /** How many moved into the dunning window this run. */
  enteredDunning: number;
  /** How many expired this run. */
  expired: number;
  /** How many expiries also deactivated a store (paid plan lapsed). When > 0
   * the cron revalidates storefront caches so hidden stores drop out at once. */
  deactivated: number;
}

/**
 * Build the query that selects subscriptions DUE for reconciliation: occupying
 * the active slot and with some clock already passed (trial end, paid period
 * end, or a scheduled retry). Exported for tests. Free/non-recurring plans have
 * null period/trial/retry dates, so they never match — no wasted work on them.
 */
export function dueForReconciliationQuery(now: Date): Record<string, unknown> {
  return {
    provider: { $ne: "stripe" },
    occupiesActiveSlot: true,
    $or: [
      { status: VENDOR_SUBSCRIPTION_STATUS.TRIALING, trialEnd: { $lt: now } },
      {
        status: VENDOR_SUBSCRIPTION_STATUS.ACTIVE,
        currentPeriodEnd: { $lt: now },
      },
      // Past-due rows always need re-evaluation once a retry is due OR the grace
      // window may have closed; nextRetryAt/gracePeriodEnd cover both.
      {
        status: VENDOR_SUBSCRIPTION_STATUS.PAST_DUE,
        nextRetryAt: { $lte: now },
      },
      {
        status: VENDOR_SUBSCRIPTION_STATUS.PAST_DUE,
        gracePeriodEnd: { $lte: now },
      },
    ],
  };
}

/**
 * Periodic reconciliation entry point (called by the cron route). Finds every
 * subscription whose lifecycle clock has passed and runs the same lazy
 * reconciliation `getEffectiveSubscription` performs — so a lapsed vendor's
 * dunning advances and their subscription eventually expires even if they never
 * open their dashboard. Idempotent: re-running processes only rows still due.
 *
 * Batched to bound memory/time per invocation; the cron re-runs on a schedule,
 * so a large backlog drains across successive runs.
 *
 * @param limit  max subscriptions to process this run (default 100).
 * @param now    injectable clock for tests.
 */
export async function reconcileDueSubscriptions(
  limit = 100,
  now: Date = new Date(),
): Promise<ReconcileSummary> {
  const due = await VendorSubscription.find(dueForReconciliationQuery(now))
    .sort({ currentPeriodEnd: 1, trialEnd: 1 })
    .limit(limit)
    .select("vendorId")
    .lean<{ vendorId: Types.ObjectId }[]>();

  const summary: ReconcileSummary = {
    scanned: due.length,
    enteredDunning: 0,
    expired: 0,
    deactivated: 0,
  };

  // Sequential to keep DB load predictable and avoid racing two reconciliations
  // of the same vendor; the batch size bounds total time.
  for (const row of due) {
    try {
      const result = await getEffectiveSubscription(row.vendorId, { now });
      if (result.justEnteredDunning) summary.enteredDunning += 1;
      if (result.justExpired) summary.expired += 1;
      if (result.justDeactivatedStore) summary.deactivated += 1;
    } catch (error) {
      // A single bad row must not abort the batch; the next run retries it.
      console.error(
        "reconcileDueSubscriptions: failed for vendor",
        String(row.vendorId),
        error,
      );
    }
  }

  return summary;
}
