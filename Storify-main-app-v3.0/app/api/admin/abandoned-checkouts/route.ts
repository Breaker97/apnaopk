import { paginatedResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import {
  abandonedCheckoutViewerForStaff,
  fetchAbandonedCheckoutList,
} from "@/lib/orders/abandoned-checkout-list";

/**
 * GET /api/admin/abandoned-checkouts — the store's abandoned checkouts, one
 * page at a time.
 *
 * Staff need a grant of their own (`view_abandoned_checkouts`) and see what
 * their scope reaches: limited to vendors, the checkouts holding one of those
 * vendors' goods; to regions, those shipping there. A vendor's own staff never
 * hold the grant — their vendor reads `GET /api/vendor/abandoned-checkouts`.
 */
export const GET = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.VIEW_ABANDONED_CHECKOUTS],
  },
  async ({ request, staff }) => {
    const list = await fetchAbandonedCheckoutList(
      request.nextUrl.searchParams,
      abandonedCheckoutViewerForStaff(staff),
    );
    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);
