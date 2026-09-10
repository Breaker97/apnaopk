import type Stripe from "stripe";
import {
  SUBSCRIPTION_DUNNING,
  VENDOR_BILLING_INTERVAL,
  VENDOR_SUBSCRIPTION_STATUS,
  type VendorSubscriptionStatus,
} from "@/config/app.config";

interface VendorStripeMetadata {
  applicationId: string | null;
  vendorId: string | null;
  userId: string | null;
  planId: string | null;
  localSubscriptionId: string | null;
}

export interface NormalizedStripeSubscription {
  id: string;
  customerId: string | null;
  status: string;
  localStatus: VendorSubscriptionStatus;
  subscriptionItemId: string | null;
  priceId: string | null;
  latestInvoiceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  providerCreatedAt: Date | null;
  metadata: VendorStripeMetadata;
}

interface ActivationDecisionInput {
  invoiceStatus?: string | null;
  subscriptionStatus?: string | null;
  expectedPriceId?: string | null;
  actualPriceId?: string | null;
  allowLegacyTrial?: boolean;
}

interface PlanChangeComparable {
  price: number;
  billingInterval: string;
  limits?: {
    products?: number | null;
    staff?: number | null;
  } | null;
  capabilities?: {
    aiAuthoring?: boolean;
  } | null;
}

function stripeId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id ? id : null;
  }
  return null;
}

function stripeDate(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(value * 1000)
    : null;
}

function mapStripeSubscriptionStatus(
  status: string | null | undefined,
): VendorSubscriptionStatus {
  if (status === "incomplete") return VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE;
  if (status === "trialing") return VENDOR_SUBSCRIPTION_STATUS.TRIALING;
  if (status === "active") return VENDOR_SUBSCRIPTION_STATUS.ACTIVE;
  if (status === "canceled") return VENDOR_SUBSCRIPTION_STATUS.CANCELLED;
  if (status === "incomplete_expired") {
    return VENDOR_SUBSCRIPTION_STATUS.EXPIRED;
  }
  return VENDOR_SUBSCRIPTION_STATUS.PAST_DUE;
}

export function normalizeStripeSubscription(
  subscription: Stripe.Subscription,
): NormalizedStripeSubscription {
  const raw = subscription as unknown as {
    created?: number;
    customer?: unknown;
    latest_invoice?: unknown;
    trial_start?: number | null;
    trial_end?: number | null;
    cancel_at_period_end?: boolean;
    metadata?: Record<string, string> | null;
    items?: {
      data?: Array<{
        id?: string;
        current_period_start?: number;
        current_period_end?: number;
        price?: unknown;
      }>;
    };
  };
  const items = raw.items?.data ?? [];
  const primaryItem = items[0];
  const periodStarts = items
    .map((item) => item.current_period_start)
    .filter((value): value is number => typeof value === "number" && value > 0);
  const periodEnds = items
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === "number" && value > 0);
  const metadata = raw.metadata ?? {};

  return {
    id: subscription.id,
    customerId: stripeId(raw.customer),
    status: subscription.status,
    localStatus: mapStripeSubscriptionStatus(subscription.status),
    subscriptionItemId: primaryItem?.id || null,
    priceId: stripeId(primaryItem?.price),
    latestInvoiceId: stripeId(raw.latest_invoice),
    currentPeriodStart:
      periodStarts.length > 0
        ? stripeDate(Math.min(...periodStarts))
        : null,
    currentPeriodEnd:
      periodEnds.length > 0 ? stripeDate(Math.max(...periodEnds)) : null,
    trialStart: stripeDate(raw.trial_start),
    trialEnd: stripeDate(raw.trial_end),
    cancelAtPeriodEnd: Boolean(raw.cancel_at_period_end),
    providerCreatedAt: stripeDate(raw.created),
    metadata: {
      applicationId: metadata.applicationId || null,
      vendorId: metadata.vendorId || null,
      userId: metadata.userId || null,
      planId: metadata.planId || null,
      localSubscriptionId: metadata.localSubscriptionId || null,
    },
  };
}

export function invoiceFailureGrace(
  firstFailure: Date | string | null | undefined,
  now: Date,
): { firstPaymentFailedAt: Date; gracePeriodEnd: Date } {
  const parsed = firstFailure ? new Date(firstFailure) : null;
  const firstPaymentFailedAt =
    parsed && Number.isFinite(parsed.getTime()) ? parsed : now;
  return {
    firstPaymentFailedAt,
    gracePeriodEnd: new Date(
      firstPaymentFailedAt.getTime() +
        SUBSCRIPTION_DUNNING.GRACE_PERIOD_DAYS * 86_400_000,
    ),
  };
}

export function canActivatePaidPlan(
  input: ActivationDecisionInput,
): boolean {
  const subscriptionAllowsAccess =
    input.subscriptionStatus === "active" ||
    (input.subscriptionStatus === "trialing" &&
      input.allowLegacyTrial === true);

  return (
    input.invoiceStatus === "paid" &&
    subscriptionAllowsAccess &&
    Boolean(input.expectedPriceId) &&
    input.expectedPriceId === input.actualPriceId
  );
}

function monthlyEquivalent(price: number, interval: string): number {
  if (interval === VENDOR_BILLING_INTERVAL.YEARLY) return price / 12;
  if (interval === VENDOR_BILLING_INTERVAL.NONE) return 0;
  return price;
}

function normalizedLimit(value: number | null | undefined): number {
  return value == null ? Number.POSITIVE_INFINITY : value;
}

export function classifyPlanChange(
  current: PlanChangeComparable,
  target: PlanChangeComparable,
): "upgrade" | "downgrade" {
  const currentMonthly = monthlyEquivalent(
    current.price,
    current.billingInterval,
  );
  const targetMonthly = monthlyEquivalent(target.price, target.billingInterval);
  const productDelta =
    normalizedLimit(target.limits?.products) -
    normalizedLimit(current.limits?.products);
  const staffDelta =
    normalizedLimit(target.limits?.staff) -
    normalizedLimit(current.limits?.staff);
  const currentAi = Boolean(current.capabilities?.aiAuthoring);
  const targetAi = Boolean(target.capabilities?.aiAuthoring);
  const benefitReduced =
    productDelta < 0 || staffDelta < 0 || (currentAi && !targetAi);
  const benefitExpanded =
    productDelta > 0 || staffDelta > 0 || (!currentAi && targetAi);
  const priceReduced = targetMonthly < currentMonthly;
  const priceIncreased = targetMonthly > currentMonthly;

  if (benefitReduced || priceReduced) return "downgrade";
  if (benefitExpanded || priceIncreased) return "upgrade";
  return "downgrade";
}

export function isTerminalStripeSubscriptionStatus(status: string): boolean {
  return status === "canceled" || status === "incomplete_expired";
}

