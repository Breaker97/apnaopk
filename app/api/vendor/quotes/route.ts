import { withApi } from "@/lib/api/handler";
import { paginatedResponse } from "@/lib/api/response";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { fetchVendorQuoteList } from "@/lib/quotes/quotes";
import { requireVendorQuoteView } from "@/lib/quotes/vendor-quote-access";

/**
 * GET /api/vendor/quotes — the vendor's own quote requests, one page at a
 * time, read through the same query string as the vendor Quotes page.
 *
 * Gated on viewing orders, as the store's Quotes page is: a quote is the step
 * before an order, and a new permission would lock every existing vendor out
 * until someone re-saved their access. Only this vendor's quotes, chosen by
 * the signed-in account — never by anything in the request.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:quotes:list", preset: "lenient" },
  },
  async ({ request, session }) => {
    await assertVendorPermission(
      session.user,
      VENDOR_PERMISSIONS.VIEW_ORDERS,
      "You do not have permission to view quotes",
    );
    const view = await requireVendorQuoteView(session.user.id);
    const list = await fetchVendorQuoteList(request.nextUrl.searchParams, view);
    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);
