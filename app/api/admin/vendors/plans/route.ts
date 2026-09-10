import { VendorPlan } from "@/models";
import { paginatedResponse, successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { validateBody, validateQuery } from "@/lib/api/validate";
import { AdminListQuerySchema, CreateVendorPlanSchema } from "@/lib/validations";
import { auditCreate, createAuditContext } from "@/lib/audit";
import { getSettings } from "@/models/settings.model";
import { connectDB } from "@/lib/db";
import {
  ensureStripePriceForVendorPlan,
  isActivePaidVendorPlan,
} from "@/lib/vendors/vendor-plan-stripe";
import { slugify } from "@/lib/strings";

/** Plans are a multi-vendor-only feature and only exist once the admin has
 * enabled subscription plans in Vendor Configuration. */
async function assertPlansEnabled() {
  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled || !settings.vendorConfig?.plansEnabled) {
    throw new NotFoundError("Vendor plans");
  }
  return settings;
}

async function uniquePlanSlug(name: string) {
  const base = slugify(name) || "plan";
  let slug = base;
  let n = 1;
  // Small catalog — a short probe loop is fine.
  while (await VendorPlan.exists({ slug })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

/**
 * GET /api/admin/vendors/plans
 * List subscription plans (admin only).
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendorPlans:list", preset: "lenient" },
  },
  async ({ request }) => {
    await assertPlansEnabled();
    const { page, limit, search, status } = validateQuery(
      request,
      AdminListQuerySchema,
    );

    const query: Record<string, unknown> = {};
    if (status && status !== "all") query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;
    const [plans, total] = await Promise.all([
      VendorPlan.find(query)
        .sort({ sortOrder: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      VendorPlan.countDocuments(query),
    ]);

    return paginatedResponse(plans, page, limit, total);
  },
);

/**
 * POST /api/admin/vendors/plans
 * Create a subscription plan (admin only).
 */
export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendorPlans:create", preset: "moderate" },
  },
  async ({ request, session }) => {
    const settings = await assertPlansEnabled();
    const body = await validateBody(request, CreateVendorPlanSchema);

    const slug = await uniquePlanSlug(body.name);

    // A free plan (interval "none") must have price 0.
    const billingInterval = body.billingInterval ?? "none";
    const price = billingInterval === "none" ? 0 : (body.price ?? 0);
    if (billingInterval !== "none" && price <= 0) {
      throw new ValidationError("Paid vendor plans require a price greater than 0");
    }
    // Trial days belong to paid plans only — a free plan has no charge to defer.
    if (billingInterval === "none" && Number(body.trialDays ?? 0) > 0) {
      throw new ValidationError(
        "A free plan has nothing to trial; set trial days to 0",
      );
    }

    // At most one active default plan — clear any existing default first.
    if (body.isDefault) {
      await VendorPlan.updateMany(
        { isDefault: true },
        { $set: { isDefault: false } },
      );
    }

    const plan = await VendorPlan.create({
      name: body.name.trim(),
      slug,
      description: body.description || undefined,
      price,
      billingInterval,
      commissionRate: body.commissionRate,
      trialDays:
        billingInterval === "none" ? 0 : (body.trialDays ?? 0),
      features: body.features ?? [],
      limits: body.limits ?? {},
      capabilities: body.capabilities ?? {},
      isDefault: Boolean(body.isDefault),
      status: body.status ?? "active",
      sortOrder: body.sortOrder ?? 0,
      stripeProductId: body.stripeProductId || undefined,
      stripePriceId: body.stripePriceId || undefined,
      createdBy: session.user.id,
    });

    if (isActivePaidVendorPlan(plan)) {
      try {
        const stripeFields = await ensureStripePriceForVendorPlan(plan, settings);
        plan.set(stripeFields);
      } catch (error) {
        await VendorPlan.deleteOne({ _id: plan._id }).catch((deleteError) =>
          console.error("Failed to roll back unsynced paid vendor plan", deleteError),
        );
        throw error;
      }
    }

    const auditContext = createAuditContext(request, session);
    await auditCreate(
      auditContext,
      "vendorPlan",
      String(plan._id),
      plan.toObject() as unknown as Record<string, unknown>,
    );

    return successResponse(plan, "Plan created successfully", 201);
  },
);
