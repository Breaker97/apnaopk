import { validateQuery } from "@/lib/api/validate";
import { AdminListQuerySchema } from "@/lib/validations";
import { createAuditContext } from "@/lib/audit";
import { auditStaffExported } from "@/lib/access/audit-staff";
import { buildStaffExport } from "@/lib/access/staff-export";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/admin/staff/export
 * The Team page as a CSV file: administrators and platform staff, narrowed by
 * the same `search` and `status` the page was showing.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:staff:export", preset: "lenient" },
  },
  async ({ request, session }) => {
    const query = validateQuery(request, AdminListQuerySchema);
    const { response, rowCount, filters } = await buildStaffExport(
      request,
      query,
      "admin",
    );

    // Recorded once the file is built, as for the catalog exports.
    await auditStaffExported(createAuditContext(request, session), {
      rowCount,
      filters,
    });
    return response;
  },
);
