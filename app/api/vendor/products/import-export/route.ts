import { connectDB } from "@/lib/db";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { errorResponse, successResponse } from "@/lib/api/response";
import { validateQuery } from "@/lib/api/validate";
import { AdminListQuerySchema } from "@/lib/validations";
import { Product } from "@/models";
import { getSettings } from "@/models/settings.model";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { hasVendorPermission, isAdmin, assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { checkPlanLimit } from "@/lib/vendors/vendor-limits";
import {
  importProductsFile,
  productsCsvResponse,
} from "@/lib/products/import-export";
import { withApi } from "@/lib/api/handler";

function buildVendorProductQuery(params: {
  vendorId: unknown;
  search?: string;
  status?: string;
}) {
  const query: Record<string, unknown> = { vendorId: params.vendorId };

  if (params.search) {
    query.$or = [
      { name: { $regex: params.search, $options: "i" } },
      { sku: { $regex: params.search, $options: "i" } },
    ];
  }

  if (params.status && params.status !== "all") {
    query.status = params.status;
  }

  return query;
}

export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_PRODUCTS,
      "You do not have permission to view products",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:products:export",
      "lenient",
      session.user.role,
    );

    const { search, status, sortBy, sortOrder } = validateQuery(
      request,
      AdminListQuerySchema,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });
    if (!vendor) throw new AuthorizationError("Vendor profile not found");

    const allowedSortFields = new Set([
      "createdAt",
      "updatedAt",
      "name",
      "price",
      "stock",
      "status",
    ]);
    const effectiveSortBy =
      sortBy && allowedSortFields.has(sortBy) ? sortBy : "createdAt";

    const products = await Product.find(
      buildVendorProductQuery({ vendorId: vendor._id, search, status }),
    )
      .populate("vendorId", "storeName slug")
      .populate("category", "name slug")
      .populate("brand", "name slug")
      .sort({ [effectiveSortBy]: sortOrder === "asc" ? 1 : -1 })
      .limit(5000)
      .lean();

    return productsCsvResponse(
      products as unknown as Parameters<typeof productsCsvResponse>[0],
      "vendor-products",
    );
  },
);

export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const user = session.user;
    const canCreate = await hasVendorPermission(
      user,
      VENDOR_PERMISSIONS.CREATE_PRODUCTS,
    );
    const canEdit = await hasVendorPermission(
      user,
      VENDOR_PERMISSIONS.EDIT_PRODUCTS,
    );
    if (!canCreate && !canEdit && !isAdmin(user)) {
      throw new AuthorizationError(
        "You do not have permission to import products",
      );
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:products:import",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });
    if (!vendor) throw new AuthorizationError("Vendor profile not found");

    // Enforce the plan's product cap. A CSV imports an unknown number of rows,
    // so this is a coarse gate: block the import outright when the vendor is
    // already at or over the cap. Rows within a partially-full plan still import
    // and may overshoot the cap (soft limit) — the per-product create gate is
    // the precise boundary; this only stops an already-full vendor.
    const productLimit = await checkPlanLimit(vendor._id, "products", {
      planId: vendor.planId,
      settings,
    });
    if (!productLimit.allowed) {
      throw new ValidationError({
        plan: [
          `Your plan allows up to ${productLimit.limit} products (you have ${productLimit.current}). Upgrade your plan before importing more.`,
        ],
      });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return errorResponse("A CSV or JSON catalog file is required.", 400);
    }

    const result = await importProductsFile(file.name, await file.text(), {
      defaultVendorId: String(vendor._id),
      productSource: "vendor",
      forceVendorId: String(vendor._id),
      allowVendorColumn: false,
      allowFeatured: false,
      countryAvailability: settings.general?.countryAvailability,
    });

    return successResponse(result);
  },
);
