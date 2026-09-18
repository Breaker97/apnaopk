import { Coupon } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validatePartialBody, isValidObjectId } from "@/lib/api/validate";
import { UpdateCouponSchema } from "@/lib/validations";
import { auditDelete, auditUpdate, createAuditContext } from "@/lib/audit";

type RouteParams = { id: string };

/**
 * GET /api/admin/coupons/[id]
 * Get single coupon
 */
export const GET = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:coupons:read", preset: "lenient" },
  },
  async ({ params }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Coupon");
    const coupon = await Coupon.findById(id).lean();

    if (!coupon) {
      return notFoundResponse("Coupon");
    }

    return successResponse(coupon);
  },
);

/**
 * PUT /api/admin/coupons/[id]
 * Update a coupon
 */
export const PUT = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:coupons:update", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Coupon");

    const body = await validatePartialBody(request, UpdateCouponSchema);
    const mutableBody = body as Record<string, unknown> & {
      userLimit?: unknown;
      perUserLimit?: unknown;
    };

    // Don't allow changing the code
    delete mutableBody.code;
    delete mutableBody.createdBy;
    delete mutableBody.usedCount;
    delete mutableBody.excludedCategories;

    if (
      typeof mutableBody.perUserLimit !== "number" &&
      typeof mutableBody.userLimit === "number"
    ) {
      mutableBody.perUserLimit = mutableBody.userLimit;
    }
    delete mutableBody.userLimit;
    if (mutableBody.type === "free_shipping") {
      mutableBody.value = 0;
    }

    const before = await Coupon.findById(id).lean();
    const coupon = await Coupon.findByIdAndUpdate(
      id,
      { $set: mutableBody },
      { returnDocument: "after", runValidators: true }
    ).lean();

    if (!coupon) {
      return notFoundResponse("Coupon");
    }

    const auditContext = createAuditContext(request, session);
    await auditUpdate(
      auditContext,
      "coupon",
      id,
      (before || {}) as unknown as Record<string, unknown>,
      coupon as unknown as Record<string, unknown>,
    );

    return successResponse(coupon);
  },
);

/**
 * DELETE /api/admin/coupons/[id]
 * Delete a coupon
 */
export const DELETE = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:coupons:delete", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Coupon");

    const before = await Coupon.findById(id).lean();
    const coupon = await Coupon.findByIdAndDelete(id);

    if (!coupon) {
      return notFoundResponse("Coupon");
    }

    const auditContext = createAuditContext(request, session);
    await auditDelete(
      auditContext,
      "coupon",
      id,
      (before || coupon.toObject()) as unknown as Record<string, unknown>,
    );

    return successResponse({ message: "Coupon deleted successfully" });
  },
);
