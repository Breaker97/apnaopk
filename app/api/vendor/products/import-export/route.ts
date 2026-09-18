import { connectDB } from "@/lib/db";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
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
  auditProductImport,
  importProductsFile,
  productsCsvResponse,
} from "@/lib/products/import-export";
import { MAX_IMPORT_FILE_BYTES } from "@/lib/products/import-limits";
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

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return errorResponse("A CSV or JSON catalog file is required.", 400);
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      return errorResponse(
        "This file is larger than 5 MB. Split it into smaller files and import them one at a time.",
        413,
      );
    }

    // The plan's product cap is enforced row by row: every row that would
    // create a product past the cap fails with the upgrade message, while rows
    // that update existing products still go through.
    const productLimit = await checkPlanLimit(vendor._id, "products", {
      planId: vendor.planId,
      settings,
    });

    const result = await importProductsFile(file.name, await file.text(), {
      defaultVendorId: String(vendor._id),
      productSource: "vendor",
      allowedVendorIds: [String(vendor._id)],
      createRefusal: canCreate
        ? undefined
        : "You do not have permission to create products.",
      updateRefusal: canEdit
        ? undefined
        : "You do not have permission to edit products.",
      allowVendorColumn: false,
      allowFeatured: false,
      // Vendors pick from the platform's categories; they never add to them.
      createMissingCategories: false,
      productLimit:
        productLimit.limit == null
          ? undefined
          : { limit: productLimit.limit, current: productLimit.current },
      countryAvailability: settings.general?.countryAvailability,
    });

    await auditProductImport(request, session, file.name, result);

    return successResponse(result);
  },
);
