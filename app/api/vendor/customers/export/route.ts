import { connectDB } from "@/lib/db";
import { NotFoundError } from "@/lib/api/errors";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";
import { createAuditContext } from "@/lib/audit";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { requireVendorCustomerListPermission } from "@/lib/vendors/vendor-customer-access";
import {
  auditVendorCustomersExported,
  buildVendorCustomerExport,
} from "@/lib/customers/vendor-customer-export";
import { getSettings } from "@/models/settings.model";

/**
 * GET /api/vendor/customers/export
 * The vendor Customers page as a CSV file: every customer matching the
 * `search`, `status`, `subscription`, `tag` and sort the page was showing (up
 * to a cap), not one page of them. Needs what reading the list does.
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await requireVendorCustomerListPermission(session.user);

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:customers:export",
      "lenient",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    const { response, rowCount, truncated, filters } =
      await buildVendorCustomerExport(request, vendor._id);

    // Recorded once the file is built: the row is the only trace that a copy
    // of the seller's customers left the store.
    await auditVendorCustomersExported(
      createAuditContext(request, session, { vendorId: vendor._id }),
      { rowCount, truncated, filters },
    );
    return response;
  },
);
