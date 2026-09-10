import { withApi } from "@/lib/api/handler";
import { paginatedResponse } from "@/lib/api/response";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { fetchQuoteRequestList } from "@/lib/quotes/quotes";

/**
 * GET /api/admin/quotes — the quote inbox.
 *
 * Gated on the order permissions rather than a permission of its own: a quote
 * is a pre-sale lead, so anyone trusted to work the order queue is the same
 * person who answers these, and a new grant would lock every existing staff
 * member out until someone re-saved their permissions.
 */
export const GET = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.VIEW_ORDERS],
    rateLimit: { action: "admin:quotes:list", preset: "lenient" },
  },
  async ({ request, staff }) => {
    const list = await fetchQuoteRequestList(request.nextUrl.searchParams, {
      staffScope: staff?.scope,
    });

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);
