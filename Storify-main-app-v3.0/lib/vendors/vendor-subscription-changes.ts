import { VENDOR_BILLING_INTERVAL } from "@/config/app.config";
import { classifyPlanChange } from "@/lib/vendors/vendor-billing-state";

interface SubscriptionPlanSnapshotForChange {
  name: string;
  price: number;
  billingInterval: string;
  currency?: string;
  features?: string[];
  limits?: { products?: number | null; staff?: number | null };
  capabilities?: { aiAuthoring?: boolean };
  stripePriceId?: string | null;
}

export interface SubscriptionForPlanChange {
  id: string;
  planId: string;
  provider: string;
  providerSubscriptionId: string | null;
  subscriptionItemId: string | null;
  stripePriceId: string | null;
  currentPeriodEnd: Date | null;
  planSnapshot: SubscriptionPlanSnapshotForChange;
  commissionRateSnapshot: number;
}

export interface TargetVendorPlan {
  id: string;
  name: string;
  price: number;
  billingInterval: string;
  currency?: string;
  commissionRate: number;
  features?: string[];
  limits?: { products?: number | null; staff?: number | null };
  capabilities?: { aiAuthoring?: boolean };
  stripePriceId?: string | null;
  status: string;
}

interface PendingPlanChangePatch {
  pendingPlanId: string;
  pendingPlanSnapshot: SubscriptionPlanSnapshotForChange;
  pendingCommissionRateSnapshot: number;
  pendingChangeType: "upgrade" | "downgrade";
  pendingChangeStatus: "awaiting_vendor" | "scheduled";
  pendingChangeEffectiveAt: Date | null;
  pendingStripeInvoiceId: null;
  stripeScheduleId: string | null;
  /**
   * Restated on the downgrade patch because the two downgrade shapes disagree:
   * a free target IS a period-end cancellation at Stripe, while a paid target
   * hands the ending to the schedule and clears the flag. Omitted for an
   * upgrade, which writes nothing to Stripe and must leave the flag as it
   * found it.
   *
   * Leaving it stale is what let a cancel-then-reassign sequence show "Keep
   * subscription" for a vendor whose cancellation no longer existed.
   */
  cancelAtPeriodEnd?: boolean;
  lastReconcileError: null;
}

export interface StagePlanChangeDependencies {
  ensurePrice(plan: TargetVendorPlan): Promise<string>;
  scheduleDowngrade(input: {
    providerSubscriptionId: string;
    subscriptionItemId: string;
    currentPriceId: string;
    targetPriceId: string;
    effectiveAt: Date;
    targetPlanId: string;
  }): Promise<{ scheduleId: string }>;
  scheduleFreePlanAtPeriodEnd(input: {
    providerSubscriptionId: string;
    effectiveAt: Date;
    targetPlanId: string;
  }): Promise<{ scheduleId: string | null }>;
  savePending(patch: PendingPlanChangePatch): Promise<void>;
}

interface StagedPlanChangeResult {
  changeType: "upgrade" | "downgrade";
  pendingChangeStatus: "awaiting_vendor" | "scheduled";
  activePlanId: string;
  effectiveAt: Date | null;
  targetPriceId: string | null;
}

function targetSnapshot(
  plan: TargetVendorPlan,
  stripePriceId: string | null,
): SubscriptionPlanSnapshotForChange {
  return {
    name: plan.name,
    price: plan.price,
    billingInterval: plan.billingInterval,
    currency: plan.currency || "USD",
    features: plan.features ?? [],
    limits: plan.limits ?? {},
    capabilities: plan.capabilities ?? {},
    stripePriceId,
  };
}

export async function stageVendorPlanChange(
  current: SubscriptionForPlanChange,
  target: TargetVendorPlan,
  dependencies: StagePlanChangeDependencies,
): Promise<StagedPlanChangeResult> {
  if (target.status !== "active") {
    throw new Error("Archived vendor plans cannot be staged");
  }
  if (
    current.provider !== "stripe" ||
    !current.providerSubscriptionId ||
    !current.subscriptionItemId ||
    !current.stripePriceId ||
    !current.currentPeriodEnd
  ) {
    throw new Error(
      "An active Stripe subscription with an item and paid period is required",
    );
  }

  const changeType = classifyPlanChange(current.planSnapshot, target);
  const targetIsFree =
    target.billingInterval === VENDOR_BILLING_INTERVAL.NONE ||
    target.price <= 0;
  const targetPriceId = targetIsFree
    ? null
    : await dependencies.ensurePrice(target);
  const snapshot = targetSnapshot(target, targetPriceId);

  if (changeType === "upgrade") {
    const patch: PendingPlanChangePatch = {
      pendingPlanId: target.id,
      pendingPlanSnapshot: snapshot,
      pendingCommissionRateSnapshot: target.commissionRate,
      pendingChangeType: "upgrade",
      pendingChangeStatus: "awaiting_vendor",
      pendingChangeEffectiveAt: null,
      pendingStripeInvoiceId: null,
      stripeScheduleId: null,
      lastReconcileError: null,
    };
    await dependencies.savePending(patch);
    return {
      changeType,
      pendingChangeStatus: "awaiting_vendor",
      activePlanId: current.planId,
      effectiveAt: null,
      targetPriceId,
    };
  }

  const schedule = targetIsFree
    ? await dependencies.scheduleFreePlanAtPeriodEnd({
        providerSubscriptionId: current.providerSubscriptionId,
        effectiveAt: current.currentPeriodEnd,
        targetPlanId: target.id,
      })
    : await dependencies.scheduleDowngrade({
        providerSubscriptionId: current.providerSubscriptionId,
        subscriptionItemId: current.subscriptionItemId,
        currentPriceId: current.stripePriceId,
        targetPriceId: targetPriceId!,
        effectiveAt: current.currentPeriodEnd,
        targetPlanId: target.id,
      });
  const patch: PendingPlanChangePatch = {
    pendingPlanId: target.id,
    pendingPlanSnapshot: snapshot,
    pendingCommissionRateSnapshot: target.commissionRate,
    pendingChangeType: "downgrade",
    pendingChangeStatus: "scheduled",
    pendingChangeEffectiveAt: current.currentPeriodEnd,
    pendingStripeInvoiceId: null,
    stripeScheduleId: schedule.scheduleId,
    cancelAtPeriodEnd: targetIsFree,
    lastReconcileError: null,
  };
  await dependencies.savePending(patch);
  return {
    changeType,
    pendingChangeStatus: "scheduled",
    activePlanId: current.planId,
    effectiveAt: current.currentPeriodEnd,
    targetPriceId,
  };
}
