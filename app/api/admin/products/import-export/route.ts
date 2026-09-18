import { connectDB } from "@/lib/db";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { errorResponse, successResponse } from "@/lib/api/response";
import { validateQuery } from "@/lib/api/validate";
import { ProductListQuerySchema } from "@/lib/validations";
import { Product } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  getOrCreateDefaultVendor,
  syncDefaultVendorWithSettings,
} from "@/lib/vendors/multi-vendor";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { USER_ROLES } from "@/config/app.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffProductScopeFilter,
  hasStaffScope,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import {
  auditProductImport,
  importProductsFile,
  productsCsvResponse,
} from "@/lib/products/import-export";
import { MAX_IMPORT_FILE_BYTES } from "@/lib/products/import-limits";
import { withApi } from "@/lib/api/handler";

function buildAdminProductQuery(params: {
  search?: string;
  status?: string;
  vendor?: string;
  source?: string;
  tag?: string;
  isMultiVendor: boolean;
}) {
  const query: Record<string, unknown> = {};

  if (params.search) {
    query.$or = [
      { name: { $regex: params.search, $options: "i" } },
      { sku: { $regex: params.search, $options: "i" } },
    ];
  }

  if (params.status && params.status !== "all") {
    query.status = params.status;
  }

  if (params.isMultiVendor && params.vendor) {
    query.vendorId = params.vendor;
  }

  if (params.isMultiVendor && params.source === "vendor") {
    query.productSource = "vendor";
  } else if (params.isMultiVendor && params.source === "admin") {
    query.$and = [
      ...((query.$and as Record<string, unknown>[]) || []),
      {
        $or: [
          { productSource: "admin" },
          { productSource: { $exists: false } },
        ],
      },
    ];
  }

  if (params.tag && params.tag !== "all") {
    query.tags = params.tag;
  }

  return query;
}

export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_PRODUCTS],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:products:export",
      "lenient",
      session.user.role,
    );

    const { search, status, vendor, source, sortOrder } = validateQuery(
      request,
      ProductListQuerySchema,
    );
    const tag = request.nextUrl.searchParams.get("tag") || undefined;

    await connectDB();
    const settings = await getSettings();
    const isMultiVendor = Boolean(settings.multiVendorMode?.enabled);

    const query = buildAdminProductQuery({
      search,
      status,
      vendor,
      source,
      tag,
      isMultiVendor,
    });
    const scopedQuery = mergeScopeFilter(
      query,
      buildStaffProductScopeFilter(access.staffScope),
    );

    const products = await Product.find(scopedQuery)
      .populate("vendorId", "storeName slug")
      .populate("category", "name slug")
      .populate("brand", "name slug")
      .sort({ createdAt: sortOrder === "asc" ? 1 : -1 })
      .limit(5000)
      .lean();

    return productsCsvResponse(
      products as unknown as Parameters<typeof productsCsvResponse>[0],
      "products",
    );
  },
);

export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [
        STAFF_PERMISSIONS.CREATE_PRODUCTS,
        STAFF_PERMISSIONS.EDIT_PRODUCTS,
        STAFF_PERMISSIONS.MANAGE_PRODUCTS,
      ],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:products:import",
      "moderate",
      session.user.role,
    );

    await connectDB();
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

    const settings = await getSettings();
    await syncDefaultVendorWithSettings(
      session.user.role === USER_ROLES.ADMIN ? session.user.id : undefined,
      settings,
    );
    const defaultVendorId = String((await getOrCreateDefaultVendor(session.user.id))._id);

    // The import is one request but many writes, so it is judged per row the
    // way the product routes judge each write: creating needs the create
    // permission, editing needs edit, and a scoped staff member only reaches
    // the products — and vendors — their scope covers.
    const isAdmin = session.user.role === USER_ROLES.ADMIN;
    const holds = (permission: (typeof STAFF_PERMISSIONS)[keyof typeof STAFF_PERMISSIONS]) =>
      isAdmin ||
      Boolean(
        access.staffPermissions?.includes(permission) ||
          access.staffPermissions?.includes(STAFF_PERMISSIONS.MANAGE_PRODUCTS),
      );
    const scoped = !isAdmin && hasStaffScope(access.staffScope);
    const scopeVendorIds = scoped ? (access.staffScope?.vendorIds ?? []) : [];

    const result = await importProductsFile(file.name, await file.text(), {
      defaultVendorId: scopeVendorIds[0] ?? defaultVendorId,
      productSource: "admin",
      allowedVendorIds: scopeVendorIds.length > 0 ? scopeVendorIds : undefined,
      productScopeFilter: buildStaffProductScopeFilter(access.staffScope),
      createRefusal: !holds(STAFF_PERMISSIONS.CREATE_PRODUCTS)
        ? "You do not have permission to create products."
        : scoped && scopeVendorIds.length === 0
          ? "Staff must be assigned to a vendor before creating products."
          : undefined,
      updateRefusal: holds(STAFF_PERMISSIONS.EDIT_PRODUCTS)
        ? undefined
        : "You do not have permission to edit products.",
      allowVendorColumn: isAdmin,
      allowFeatured: true,
      // Categories are created from the admin's category screen only, so only
      // an admin's catalog may add them.
      createMissingCategories: isAdmin,
      countryAvailability: settings.general?.countryAvailability,
    });

    await auditProductImport(request, session, file.name, result);

    return successResponse(result);
  },
);
