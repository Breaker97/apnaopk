import type { VendorPermissionPack } from "@/config/permissions.config";
import type { PublicVendorPlan } from "@/lib/vendors/vendor-onboarding";

/** One plan as the admin catalogue renders it: the plan plus who is on it. */
export interface AdminVendorPlan {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  billingInterval: "monthly" | "yearly" | "none";
  commissionRate: number;
  trialDays: number;
  features: string[];
  limits: { products: number | null; staff: number | null };
  packs: VendorPermissionPack[];
  isDefault: boolean;
  status: "active" | "archived";
  /** A paid, active plan whose Stripe price is missing or switched off. */
  stripeMissing: boolean;
  /** Vendors whose `planId` points here. */
  vendorCount: number;
  /** Live subscriptions on the plan. Like vendors, they block a delete. */
  activeSubscriptionCount: number;
  /** Still named by the legacy `vendorConfig.defaultPlanId`, which blocks a delete too. */
  configuredDefault: boolean;
}

/** Vendors on no plan at all: they sell on the store commission. */
export interface CommissionOnlySummary {
  vendorCount: number;
  rate: number;
}

export type AdminPlanAction =
  | "edit"
  | "makeDefault"
  | "archive"
  | "restore"
  | "delete";

/**
 * Why the plan cannot be deleted, in the words the menu shows — the same three
 * checks `DELETE /api/admin/vendors/plans/[id]` refuses on, so the admin learns
 * it before clicking rather than from an error after.
 */
export function planDeleteBlockedReason(plan: AdminVendorPlan): string | null {
  if (plan.vendorCount > 0) {
    return `${
      plan.vendorCount === 1 ? "1 vendor is" : `${plan.vendorCount} vendors are`
    } on this plan. Archive it instead.`;
  }
  if (plan.activeSubscriptionCount > 0) {
    return "Vendors still have live subscriptions on this plan. Archive it instead.";
  }
  if (plan.configuredDefault) {
    return "Vendor Configuration still names this plan as its default.";
  }
  return null;
}

/** The plan in the shape the vendor-facing picker takes. */
export function toPublicVendorPlan(plan: AdminVendorPlan): PublicVendorPlan {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    commissionRate: plan.commissionRate,
    trialDays: plan.trialDays,
    features: plan.features,
    limits: plan.limits,
    packs: plan.packs,
    isDefault: plan.isDefault,
  };
}
