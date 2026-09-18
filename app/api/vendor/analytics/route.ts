import { connectDB } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { assertVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { getVendorDashboardData } from "@/lib/vendors/vendor-order-metrics";

/**
 * GET /api/vendor/analytics
 * Get vendor dashboard analytics
 *
 * Every figure comes from `lib/vendors/vendor-order-metrics.ts`, the module the
 * vendor orders page reads too, so the dashboard and the orders page report
 * the same numbers for the same orders.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:analytics", preset: "lenient" },
  },
  async ({ session }) => {
    // The dashboard hides the analytics widget when this grant is revoked;
    // without the same check here the vendor could just call the endpoint and
    // read revenue and order counts anyway.
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_ANALYTICS,
      "You do not have permission to view analytics",
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    return successResponse(await getVendorDashboardData(vendor._id));
  },
);
