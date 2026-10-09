import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { fetchVendorAbandonedCheckoutStats } from "@/lib/orders/abandoned-checkout-stats";
import { requireVendorAbandonedCheckoutViewer } from "@/lib/orders/vendor-abandoned-checkout-access";

/**
 * GET /api/vendor/abandoned-checkouts/stats — the figures above the vendor's
 * Abandoned checkouts list, over its own lines only: how many checkouts held
 * its goods, how many are still open, what its share of those is worth, and
 * which of its products shoppers leave behind most.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:abandoned-checkouts:stats", preset: "lenient" },
  },
  async ({ session }) => {
    await assertVendorPermission(
      session.user,
      VENDOR_PERMISSIONS.VIEW_ORDERS,
      "You do not have permission to view abandoned checkouts",
    );
    const viewer = await requireVendorAbandonedCheckoutViewer(session.user.id);
    return successResponse(await fetchVendorAbandonedCheckoutStats(viewer.vendorId));
  },
);
