import { connectDB } from "@/lib/db";
import { NotFoundError } from "@/lib/api/errors";
import { validateQuery } from "@/lib/api/validate";
import { AdminListQuerySchema } from "@/lib/validations";
import { getSettings } from "@/models/settings.model";
import { createAuditContext } from "@/lib/audit";
import {
  auditVendorsExported,
  buildVendorExport,
} from "@/lib/vendors/vendor-export";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/admin/vendors/export
 * The Vendors page as a CSV file, narrowed by the same `search`, `status` and
 * `sortOrder` the page was showing. Gated like the list it exports: a store
 * without multi-vendor mode has no vendors page.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendors:export", preset: "lenient" },
  },
  async ({ request, session }) => {
    const query = validateQuery(request, AdminListQuerySchema);

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const { response, rowCount, filters } = await buildVendorExport(
      request,
      query,
    );

    // Recorded once the file is built, as for the catalog exports.
    await auditVendorsExported(createAuditContext(request, session), {
      rowCount,
      filters,
    });
    return response;
  },
);
