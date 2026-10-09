import { withApi } from "@/lib/api/handler";
import { paginatedResponse } from "@/lib/api/response";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { fetchAbandonedCheckoutList } from "@/lib/orders/abandoned-checkout-list";
import { requireVendorAbandonedCheckoutViewer } from "@/lib/orders/vendor-abandoned-checkout-access";

/**
 * GET /api/vendor/abandoned-checkouts — the checkouts that held this vendor's
 * products, one page at a time, read through the same query string as the
 * vendor's page.
 *
 * Each row is the vendor's own lines and nothing else: no other seller's
 * goods, no basket total, and no shopper named — no name, email, phone,
 * address or recovery link (`toVendorAbandonedCheckout`). Read-only: the
 * recovery emails are the store's.
 *
 * Gated on viewing orders, as the vendor's Quotes are: a new permission would
 * be revoked on read for every vendor still on the old permission list. The
 * vendor comes from the signed-in account — never from anything in the
 * request.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:abandoned-checkouts:list", preset: "lenient" },
  },
  async ({ request, session }) => {
    await assertVendorPermission(
      session.user,
      VENDOR_PERMISSIONS.VIEW_ORDERS,
      "You do not have permission to view abandoned checkouts",
    );
    const viewer = await requireVendorAbandonedCheckoutViewer(session.user.id);
    const list = await fetchAbandonedCheckoutList(request.nextUrl.searchParams, viewer);
    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);
