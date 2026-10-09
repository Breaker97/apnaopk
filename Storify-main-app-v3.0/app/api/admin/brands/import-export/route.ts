import { connectDB } from "@/lib/db";
import { errorResponse, successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";
import { createAuditContext } from "@/lib/audit";
import { auditCatalogExport, auditCatalogImport } from "@/lib/catalog/catalog-audit";
import { fetchBrandsForExport } from "@/lib/catalog/brand-list";
import {
  adminBrandsCsvResponse,
  importBrandsCsv,
} from "@/lib/catalog/brand-import-export";
import { MAX_IMPORT_FILE_BYTES } from "@/lib/products/import-limits";

/**
 * GET /api/admin/brands/import-export
 * Export brands as CSV for the list's current search, tab and sort (Admin only).
 */
export const GET = withApi({ auth: "admin" }, async ({ request, session }) => {
  await rateLimitByUser(
    request,
    session.user.id,
    "admin:brands:export",
    "moderate",
    session.user.role,
  );
  await connectDB();

  const searchParams = request.nextUrl.searchParams;
  const brands = await fetchBrandsForExport(searchParams);

  const response = adminBrandsCsvResponse(brands);
  // Recorded once the file is built: the row is the only trace that a copy of
  // the catalog was taken, and it says how much and what narrowed it.
  await auditCatalogExport(createAuditContext(request, session), "brand", {
    rowCount: brands.length,
    filters: {
      search: searchParams.get("search")?.trim() || undefined,
      status: searchParams.get("status") || undefined,
    },
  });
  return response;
});

/**
 * POST /api/admin/brands/import-export
 * Import brands from an uploaded CSV (Admin only). Rows that match an existing
 * brand update it; the rest create platform-owned, approved brands.
 */
export const POST = withApi({ auth: "admin" }, async ({ request, session }) => {
  await rateLimitByUser(
    request,
    session.user.id,
    "admin:brands:import",
    "moderate",
    session.user.role,
  );
  await connectDB();

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

  const result = await importBrandsCsv(await file.text(), { role: "admin" });
  await auditCatalogImport(
    createAuditContext(request, session),
    "brand",
    file.name,
    result,
  );
  return successResponse(result);
});
