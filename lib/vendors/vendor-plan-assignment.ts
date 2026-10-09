import type { HydratedDocument } from "mongoose";
import { VendorPlan, VendorSubscription } from "@/models";
import {
  VENDOR_BILLING_INTERVAL,
  VENDOR_SUBSCRIPTION_STATUS,
} from "@/config/app.config";
import { isValidObjectId } from "@/lib/api/validate";
import { resolveVendorCommission } from "@/lib/vendors/vendor-commission";
import { buildSubscriptionForPlan } from "@/lib/vendors/vendor-subscriptions";
import { draftExcessProducts } from "@/lib/vendors/vendor-limits";
import type { ISettings } from "@/models/settings.model";
import type { IVendorPlan } from "@/models/vendorPlan.model";
import type { IVendorSubscription } from "@/models/vendorSubscription.model";
import type { IVendor } from "@/types";

/**
 * Putting a vendor on a plan without a payment: the admin's "assign plan" for a
 * free plan, and the vendor import. A paid plan never comes through here — it
 * needs the vendor's application as its billing record, and an admin-made or
 * imported vendor has none.
 */

/** The plans feature is on, on a marketplace. */
export function vendorPlansEnabled(
  settings: Pick<ISettings, "multiVendorMode" | "vendorConfig">,
): boolean {
  return Boolean(
    settings.multiVendorMode?.enabled && settings.vendorConfig?.plansEnabled,
  );
}

/** A plan the vendor pays for: a billing period and a price above nothing. */
export function isPaidVendorPlan(plan: {
  billingInterval?: string;
  price?: number;
}): boolean {
  return (
    plan.billingInterval !== VENDOR_BILLING_INTERVAL.NONE &&
    Number(plan.price ?? 0) > 0
  );
}

/**
 * The plan a new vendor gets when they name none — the one the wizard
 * pre-selects (see `pickDefaultVendorPlanId`): the plan marked Default, else
 * the legacy `vendorConfig.defaultPlanId`. Archived plans are never offered.
 */
export async function findDefaultVendorPlan(
  settings: Pick<ISettings, "vendorConfig">,
): Promise<HydratedDocument<IVendorPlan> | null> {
  const marked = await VendorPlan.findOne({ isDefault: true, status: "active" });
  if (marked) return marked;
  const configured = settings.vendorConfig?.defaultPlanId;
  if (!configured || !isValidObjectId(configured)) return null;
  return VendorPlan.findOne({ _id: configured, status: "active" });
}

/**
 * Move a vendor onto a free plan: the plan's rate becomes the vendor's (and a
 * store-default sweep leaves it alone), the store opens, and a new active
 * subscription replaces the one the vendor held. Products over the plan's cap
 * go back to draft. The caller audits it.
 */
export async function assignFreeVendorPlan(input: {
  vendor: HydratedDocument<IVendor>;
  plan: HydratedDocument<IVendorPlan>;
  /** The subscription in the vendor's active slot, which this one replaces. */
  current?: HydratedDocument<IVendorSubscription> | null;
  actorId: string;
  settings: ISettings;
  activationMode?: "auto" | "manual";
}) {
  const { vendor, plan, current, actorId, settings } = input;
  if (current) {
    current.status = VENDOR_SUBSCRIPTION_STATUS.CANCELLED;
    current.occupiesActiveSlot = false;
    await current.save();
  }
  vendor.commission = resolveVendorCommission(vendor, plan, settings);
  // The plan states the rate now; a store-default sweep must not touch it.
  vendor.commissionSource = "plan";
  vendor.planId = plan._id;
  vendor.storeActive = true;
  await vendor.save();
  const subscription = await VendorSubscription.create(
    buildSubscriptionForPlan(vendor._id, plan, actorId, {
      activationMode: input.activationMode,
      storeCurrency: settings.general?.defaultCurrency,
    }),
  );
  const draftResult = await draftExcessProducts(
    vendor._id,
    plan.limits?.products ?? null,
  );
  return { subscription, draftedProducts: draftResult.drafted };
}
