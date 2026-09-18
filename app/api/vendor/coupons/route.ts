import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { connectDB } from "@/lib/db";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { Coupon } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { paginatedResponse, successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { validateBody, validateQuery } from "@/lib/api/validate";
import { AdminListQuerySchema, CreateCouponSchema } from "@/lib/validations";
import { auditCreate, createAuditContext } from "@/lib/audit";
import { withApi } from "@/lib/api/handler";
import { fetchCouponList } from "@/lib/catalog/coupon-list";

/**
 * GET /api/vendor/coupons
 * Get coupons for the current vendor.
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_DISCOUNTS,
      "You do not have permission to view discounts",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:coupons:list",
      "lenient",
      session.user.role,
    );

    const { page, limit, search, status } = validateQuery(
      request,
      AdminListQuerySchema,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    const list = await fetchCouponList(
      { page, limit, search, status },
      { vendorId: vendor._id },
    );

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);

/**
 * POST /api/vendor/coupons
 * Create a coupon for the current vendor.
 */
export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.CREATE_DISCOUNTS,
      "You do not have permission to create discounts",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:coupons:create",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    const body = await validateBody(request, CreateCouponSchema);
    const code =
      typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!code) throw new ValidationError({ code: ["Coupon code is required"] });

    const existing = await Coupon.findOne({ code });
    if (existing) {
      throw new ValidationError({ code: ["This coupon code already exists"] });
    }

    const perUserLimit =
      typeof (body as { perUserLimit?: unknown }).perUserLimit === "number"
        ? (body as { perUserLimit: number }).perUserLimit
        : typeof (body as { userLimit?: unknown }).userLimit === "number"
          ? (body as { userLimit: number }).userLimit
          : undefined;

    const payload = Object.fromEntries(
      Object.entries(body as unknown as Record<string, unknown>).filter(
        // A vendor's coupon is always the vendor's to pay for.
        ([key]) =>
          key !== "userLimit" && key !== "excludedCategories" && key !== "fundedBy",
      ),
    );
    if (payload.type === "free_shipping") {
      payload.value = 0;
    }

    const coupon = await Coupon.create({
      ...payload,
      code,
      vendorId: vendor._id,
      perUserLimit,
      createdBy: session.user.id,
    });

    const auditContext = createAuditContext(request, session);
    await auditCreate(
      auditContext,
      "coupon",
      String(coupon._id),
      coupon.toObject() as unknown as Record<string, unknown>,
    );

    return successResponse(coupon, "Coupon created successfully", 201);
  },
);
