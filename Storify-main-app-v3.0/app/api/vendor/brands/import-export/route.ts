import { connectDB } from "@/lib/db";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { errorResponse, successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { createAuditContext } from "@/lib/audit";
import { getSettings } from "@/models/settings.model";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { hasVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { auditCatalogExport, auditCatalogImport } from "@/lib/catalog/catalog-audit";
import { BRAND_EXPORT_LIMIT } from "@/lib/catalog/brand-list";
import {
  importBrandsCsv,
  vendorBrandsCsvResponse,
} from "@/lib/catalog/brand-import-export";
import { fetchVendorBrandRows } from "@/lib/vendors/vendor-brand-list";
import { MAX_IMPORT_FILE_BYTES } from "@/lib/products/import-limits";

/**
 * GET /api/vendor/brands/import-export
 * Export the brands the vendor can see (the approved catalog plus their own) as
 * CSV, for the table's current search, tab and sort. Gated behind VIEW_BRANDS,
 * and read through the same query as the vendor's Brands table, so the file
 * never holds a brand the table would not show.
 */
export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  const canView = await hasVendorPermission(
    session.user,
    VENDOR_PERMISSIONS.VIEW_BRANDS,
  );
  if (!canView) {
    throw new AuthorizationError("You do not have permission to view brands");
  }

  await rateLimitByUser(
    request,
    session.user.id,
    "vendor:brands:export",
    "lenient",
    session.user.role,
  );

  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

  const vendor = await requireApprovedVendorByUserId(session.user.id, {
    allowPaymentRequiredSetup: true,
  });

  const searchParams = request.nextUrl.searchParams;
  const rows = (await fetchVendorBrandRows(searchParams, vendor._id)).slice(
    0,
    BRAND_EXPORT_LIMIT,
  );

  const response = vendorBrandsCsvResponse(rows);
  await auditCatalogExport(
    createAuditContext(request, session, { vendorId: vendor._id }),
    "brand",
    {
      rowCount: rows.length,
      filters: {
        search: searchParams.get("search")?.trim() || undefined,
        status: searchParams.get("status") || undefined,
      },
    },
  );
  return response;
});

/**
 * POST /api/vendor/brands/import-export
 * Import brands from an uploaded CSV. A vendor can create brands (CREATE_BRANDS;
 * they enter the review queue, owned by this vendor) and update brands they
 * created (EDIT_BRANDS). Rows aimed at anyone else's brand fail, row by row.
 */
export const POST = withApi({ auth: "user" }, async ({ request, session }) => {
  const canCreate = await hasVendorPermission(
    session.user,
    VENDOR_PERMISSIONS.CREATE_BRANDS,
  );
  const canEdit = await hasVendorPermission(
    session.user,
    VENDOR_PERMISSIONS.EDIT_BRANDS,
  );
  if (!canCreate && !canEdit) {
    throw new AuthorizationError("You do not have permission to import brands");
  }

  await rateLimitByUser(
    request,
    session.user.id,
    "vendor:brands:import",
    "moderate",
    session.user.role,
  );

  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

  // Ensures the caller is an approved vendor before allowing writes.
  const vendor = await requireApprovedVendorByUserId(session.user.id, {
    allowPaymentRequiredSetup: true,
  });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return errorResponse("CSV file is required.", 400);
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return errorResponse(
      "This file is larger than 5 MB. Split it into smaller files and import them one at a time.",
      413,
    );
  }

  const result = await importBrandsCsv(await file.text(), {
    role: "vendor",
    vendorId: String(vendor._id),
    canCreate,
    canEdit,
  });
  await auditCatalogImport(
    createAuditContext(request, session, { vendorId: vendor._id }),
    "brand",
    file.name,
    result,
  );
  return successResponse(result);
});
