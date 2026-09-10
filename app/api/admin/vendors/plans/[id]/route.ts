import { Vendor, VendorPlan, VendorSubscription } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { validatePartialBody, isValidObjectId } from "@/lib/api/validate";
import { UpdateVendorPlanSchema } from "@/lib/validations";
import { auditDelete, auditUpdate, createAuditContext } from "@/lib/audit";
import { getSettings } from "@/models/settings.model";
import { connectDB } from "@/lib/db";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/config/app.config";
import {
  ensureStripePriceForVendorPlan,
  isActivePaidVendorPlan,
} from "@/lib/vendors/vendor-plan-stripe";

type RouteParams = { id: string };

async function assertPlansEnabled() {
  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled || !settings.vendorConfig?.plansEnabled) {
    throw new NotFoundError("Vendor plans");
  }
  return settings;
}

/**
 * GET /api/admin/vendors/plans/[id]
 */
export const GET = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendorPlans:read", preset: "lenient" },
  },
  async ({ params }) => {
    await assertPlansEnabled();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Plan");
    const plan = await VendorPlan.findById(id).lean();
    if (!plan) return notFoundResponse("Plan");
    return successResponse(plan);
  },
);

/**
 * PUT /api/admin/vendors/plans/[id]
 */
export const PUT = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendorPlans:update", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const settings = await assertPlansEnabled();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Plan");

    const body = await validatePartialBody(request, UpdateVendorPlanSchema);
    const update = body as Record<string, unknown>;
    // Slug and provenance are server-managed.
    delete update.slug;
    delete update.createdBy;

    const before = await VendorPlan.findById(id).lean();
    if (!before) return notFoundResponse("Plan");

    // Keep price coherent with the billing cadence, using the EFFECTIVE
    // interval (a partial PUT may change only price on an existing free plan).
    const effectiveInterval =
      (update.billingInterval as string | undefined) ?? before.billingInterval;
    if (effectiveInterval === "none") {
      update.price = 0;
    }
    const effectivePrice = Number((update.price as number | undefined) ?? before.price ?? 0);
    if (effectiveInterval !== "none" && effectivePrice <= 0) {
      throw new ValidationError("Paid vendor plans require a price greater than 0");
    }
    const effectiveTrialDays = Number(
      (update.trialDays as number | undefined) ?? before.trialDays ?? 0,
    );
    if (
      effectiveInterval === "none" &&
      update.trialDays !== undefined &&
      effectiveTrialDays > 0
    ) {
      throw new ValidationError(
        "A free plan has nothing to trial; set trial days to 0",
      );
    }
    // Moving a plan onto the free cadence drops any trial it carried, the same
    // way it drops the price.
    if (effectiveInterval === "none") {
      update.trialDays = 0;
    }

    const candidate = {
      ...before,
      ...update,
      _id: before._id,
      price: effectiveInterval === "none" ? 0 : effectivePrice,
      billingInterval: effectiveInterval,
      status: (update.status as string | undefined) ?? before.status,
    };
    if (isActivePaidVendorPlan(candidate)) {
      const stripeFields = await ensureStripePriceForVendorPlan(
        candidate,
        settings,
        { persist: false },
      );
      Object.assign(update, stripeFields);
    } else if (
      effectiveInterval === "none" ||
      (update.status as string | undefined) === "archived"
    ) {
      update.stripePriceActive = false;
    }

    // Only one active default plan at a time.
    if (update.isDefault === true) {
      await VendorPlan.updateMany(
        { _id: { $ne: id }, isDefault: true },
        { $set: { isDefault: false } },
      );
    }

    const plan = await VendorPlan.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true, runValidators: true },
    ).lean();
    if (!plan) return notFoundResponse("Plan");

    const auditContext = createAuditContext(request, session);
    await auditUpdate(
      auditContext,
      "vendorPlan",
      id,
      before as unknown as Record<string, unknown>,
      plan as unknown as Record<string, unknown>,
    );

    return successResponse(plan);
  },
);

/**
 * DELETE /api/admin/vendors/plans/[id]
 * Refuses deletion while any vendor is on the plan (provenance or an active
 * subscription). Archive it instead to stop offering it to new vendors.
 */
export const DELETE = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendorPlans:delete", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    await assertPlansEnabled();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Plan");

    const [vendorOnPlan, activeSub, settings] = await Promise.all([
      Vendor.exists({ planId: id }),
      VendorSubscription.exists({
        planId: id,
        status: { $in: ACTIVE_SUBSCRIPTION_STATUSES },
      }),
      getSettings(),
    ]);
    if (vendorOnPlan || activeSub) {
      throw new ValidationError(
        "This plan is in use by one or more vendors. Archive it instead of deleting.",
      );
    }
    // The plan is wired as the onboarding default — clearing it here would leave
    // a dangling defaultPlanId pointer. Make the admin unset it first.
    if (settings.vendorConfig?.defaultPlanId === id) {
      throw new ValidationError(
        "This plan is set as the default in Vendor Configuration. Change the default before deleting.",
      );
    }

    const before = await VendorPlan.findById(id).lean();
    const plan = await VendorPlan.findByIdAndDelete(id);
    if (!plan) return notFoundResponse("Plan");

    const auditContext = createAuditContext(request, session);
    await auditDelete(
      auditContext,
      "vendorPlan",
      id,
      (before || plan.toObject()) as unknown as Record<string, unknown>,
    );

    return successResponse({ message: "Plan deleted successfully" });
  },
);
