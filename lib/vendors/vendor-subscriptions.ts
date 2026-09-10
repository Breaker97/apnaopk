/**
 * Shared construction of VendorSubscription records so the admin assign endpoint
 * and vendor onboarding freeze the same plan contract.
 */

import { Types } from "mongoose";
import {
  VENDOR_BILLING_INTERVAL,
  VENDOR_SUBSCRIPTION_STATUS,
  type VendorBillingInterval,
} from "@/config/app.config";
import { subscriptionOccupiesSlot } from "@/models/vendorSubscription.model";

interface PlanForSubscription {
  _id: unknown;
  name: string;
  price: number;
  billingInterval: string;
  commissionRate: number;
  trialDays?: number;
  currency?: string;
  /** Set only once a Stripe price has been synced for the plan. */
  stripePriceCurrency?: string | null;
  features?: string[];
  limits?: { products?: number | null; staff?: number | null };
  capabilities?: { aiAuthoring?: boolean };
  stripePriceId?: string | null;
}

/**
 * Billing currency frozen onto a subscription's plan snapshot.
 *
 * `VendorPlan` carries no `currency` of its own — only `stripePriceCurrency`,
 * which exists solely once a Stripe price has been synced. A non-Stripe install
 * must therefore pass the store's default currency explicitly: defaulting to
 * "USD" is how off-Stripe renewals ended up asking the gateway to collect a
 * currency the plan was never priced in.
 */
export function resolveSubscriptionCurrency(
  plan: Pick<PlanForSubscription, "currency" | "stripePriceCurrency">,
  storeCurrency?: string | null,
) {
  return String(
    plan.currency || plan.stripePriceCurrency || storeCurrency || "USD",
  ).toUpperCase();
}

/** Whole, non-negative trial days a plan grants. */
export function trialDaysForPlan(
  plan: Pick<PlanForSubscription, "trialDays">,
): number {
  const raw = Number(plan.trialDays ?? 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/**
 * The dates that start a trial clock. Applied when the vendor is APPROVED, so
 * the trial measures selling time rather than time spent in review.
 */
export function trialWindow(
  trialDays: number,
  from: Date,
): { trialStart: Date; trialEnd: Date } {
  return {
    trialStart: from,
    trialEnd: new Date(from.getTime() + trialDays * 24 * 60 * 60 * 1000),
  };
}

/**
 * Paid plans fail closed in `incomplete` until Stripe's paid-invoice
 * synchronizer activates them. The seven-day setup window is not a plan trial.
 * Free plans activate immediately and never receive a provider billing period.
 *
 * A paid plan carrying `trialDays` is the third case: it opens `trialing` with
 * NO payment method taken, on the "manual" provider so the local clock in
 * `decideDunningTransition` owns its expiry (a `stripe` row is deliberately
 * invisible to that clock). The trial dates are stamped by
 * `trialWindow` at approval, not here — a wizard submitted on Monday
 * and approved on Friday must not burn four trial days waiting in review, and a
 * null `trialEnd` reads as "clock not running" everywhere downstream.
 */
export function buildSubscriptionForPlan(
  vendorId: unknown,
  plan: PlanForSubscription,
  createdBy: string,
  opts?: {
    now?: Date;
    activationMode?: "auto" | "manual";
    verifiedPaid?: boolean;
    /** Store default currency, used when the plan has no Stripe price synced. */
    storeCurrency?: string | null;
  },
) {
  const isPaid = plan.billingInterval !== VENDOR_BILLING_INTERVAL.NONE;
  const trialDays = trialDaysForPlan(plan);
  const startsTrial = isPaid && trialDays > 0 && !opts?.verifiedPaid;
  const status = opts?.verifiedPaid
    ? VENDOR_SUBSCRIPTION_STATUS.ACTIVE
    : startsTrial
      ? VENDOR_SUBSCRIPTION_STATUS.TRIALING
      : isPaid
        ? VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE
        : VENDOR_SUBSCRIPTION_STATUS.ACTIVE;
  const activationMode =
    opts?.activationMode ?? (isPaid && !startsTrial ? "manual" : "auto");

  return {
    vendorId: vendorId as Types.ObjectId,
    planId: plan._id as Types.ObjectId,
    status,
    trialStart: null,
    trialEnd: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    commissionRateSnapshot: plan.commissionRate,
    planSnapshot: {
      name: plan.name,
      price: plan.price,
      billingInterval: plan.billingInterval as VendorBillingInterval,
      currency: resolveSubscriptionCurrency(plan, opts?.storeCurrency),
      features: plan.features ?? [],
      limits: plan.limits ?? {},
      capabilities: plan.capabilities ?? {},
      stripePriceId: plan.stripePriceId ?? null,
    },
    activationMode,
    cancelAtPeriodEnd: false,
    provider:
      isPaid && !startsTrial ? ("stripe" as const) : ("manual" as const),
    paymentProviderRef: null,
    stripePriceId: plan.stripePriceId ?? null,
    occupiesActiveSlot: subscriptionOccupiesSlot(status),
    createdBy,
  };
}

const SUPERSEDED_ASSIGNMENT_PROVIDER_STATUS =
  "superseded_by_new_assignment";

/**
 * Selects the pending Stripe rows a fresh paid assignment replaces: every other
 * `incomplete` row for the vendor, excluding the one just written.
 *
 * Without this a re-assignment leaves the previous attempt behind, because the
 * billing sync only retires rival rows when a payment actually activates one —
 * which never happens for an attempt the vendor abandoned. Two incomplete rows
 * on the same application then make checkout fail outright, since
 * `selectVendorCheckoutSubscription` refuses an ambiguous match.
 *
 * Active free plans are excluded by the `incomplete` status: the vendor keeps
 * selling on the free plan until the paid one is paid for.
 */
export function supersededStripeAssignmentFilter(input: {
  vendorId: unknown;
  keepSubscriptionId: unknown;
}): Record<string, unknown> {
  return {
    _id: { $ne: input.keepSubscriptionId },
    vendorId: input.vendorId,
    provider: "stripe",
    status: VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
  };
}

/** The patch that retires a superseded pending assignment. */
export function supersededStripeAssignmentPatch(): Record<string, unknown> {
  return {
    status: VENDOR_SUBSCRIPTION_STATUS.CANCELLED,
    occupiesActiveSlot: subscriptionOccupiesSlot(
      VENDOR_SUBSCRIPTION_STATUS.CANCELLED,
    ),
    providerStatus: SUPERSEDED_ASSIGNMENT_PROVIDER_STATUS,
  };
}
