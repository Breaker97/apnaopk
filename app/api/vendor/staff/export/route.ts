import { NextRequest } from "next/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { validateQuery } from "@/lib/api/validate";
import { AdminListQuerySchema } from "@/lib/validations";
import { handleApiError } from "@/lib/api/errors";
import { createAuditContext } from "@/lib/audit";
import { auditStaffExported } from "@/lib/access/audit-staff";
import { buildStaffExport } from "@/lib/access/staff-export";
import { requireVendorStaffPermission } from "@/lib/access/vendor-staff-guard";

/**
 * GET /api/vendor/staff/export
 * This store's staff as a CSV file, narrowed by the same `search` and `status`
 * the page was showing. The gate is the one the staff list itself sits behind.
 */
export async function GET(request: NextRequest) {
  try {
    const { session, vendor } = await requireVendorStaffPermission(
      request,
      [
        VENDOR_PERMISSIONS.VIEW_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
      ],
      "vendor:staff:export",
      "lenient",
    );

    const query = validateQuery(request, AdminListQuerySchema);
    const { response, rowCount, filters } = await buildStaffExport(
      request,
      query,
      "vendor",
      vendor._id,
    );

    await auditStaffExported(
      createAuditContext(request, session, { vendorId: vendor._id }),
      { rowCount, filters },
    );
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
