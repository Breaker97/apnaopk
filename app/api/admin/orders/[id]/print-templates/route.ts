import { Order } from "@/models";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { buildStaffOrderScopeFilter, mergeScopeFilter } from "@/lib/access/staff-scope";
import { PLATFORM_OWNER } from "@/lib/invoice-templates/owner";
import { defaultCategories } from "@/lib/invoice-templates/service";

/**
 * GET /api/admin/orders/[id]/print-templates
 *
 * Which categories print with a template on this order page
 * (docs/INVOICE_TEMPLATE_BUILDER.md §4.8): `{ online, pos, sticker }`, each
 * true when the platform has a default. The order page shows **Print
 * invoice** only when `online` is true (D-10) and swaps the internal label's
 * print for the sticker only when `sticker` is (D-09); with all false every
 * print stays as it was (D-02).
 *
 * The same access as `print-context`: admins and staff with order view, the
 * staff scope in the order query (an order outside it is a 404). Reads only.
 */
export const GET = withApi<{ id: string }>({ auth: "user" }, async ({ params, session }) => {
  const access = await assertAdminOrStaffPermissions(
    session as unknown as { user: { id: string; role: string } },
    [STAFF_PERMISSIONS.VIEW_ORDERS],
  );
  if (!isValidObjectId(params.id)) return notFoundResponse("Order");
  const order = await Order.findOne(mergeScopeFilter({ _id: params.id }, buildStaffOrderScopeFilter(access.staffScope)))
    .select("_id")
    .lean();
  if (!order) return notFoundResponse("Order");
  return successResponse(await defaultCategories(PLATFORM_OWNER));
});
