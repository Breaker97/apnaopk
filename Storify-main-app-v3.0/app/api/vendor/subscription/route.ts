/**
 * GET /api/vendor/subscription
 * The signed-in vendor's current subscription. Reading it lazily reconciles an
 * elapsed period (see getEffectiveSubscription): the commission reverts to the
 * default and the plan benefit ends — the vendor keeps full store access. A
 * lapsed free TRIAL is the exception: it keeps the plan and closes the store
 * until the deferred first payment is made.
 */

import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { getEffectiveSubscription } from "@/lib/vendors/vendor-plans";
import { Vendor, VendorPlan } from "@/models";

export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:subscription:read", preset: "lenient" },
  },
  async ({ session }) => {
    const settings = await getSettings();
    if (
      !settings.multiVendorMode?.enabled ||
      !settings.vendorConfig?.plansEnabled
    ) {
      throw new NotFoundError("Vendor plans");
    }

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    const effective = await getEffectiveSubscription(vendor._id, { settings });

    // Re-read the (possibly just-reconciled) commission/plan from the vendor.
    const current = await Vendor.findById(vendor._id)
      .select("commission planId")
      .lean<{ commission?: number; planId?: unknown } | null>();

    const plan = effective.subscription?.planId
      ? await VendorPlan.findById(effective.subscription.planId as string).lean()
      : null;

    return successResponse({
      subscription: effective.subscription,
      status: effective.status,
      plan,
      commission: current?.commission ?? null,
      onPlan: current?.planId != null,
    });
  },
);
