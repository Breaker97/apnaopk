import { Order } from "@/models";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { assertVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { buildOrderContext, selectConsignments } from "@/lib/invoice-templates/context";
import { vendorOwner } from "@/lib/invoice-templates/owner";
import { resolveDefault } from "@/lib/invoice-templates/service";
import { parseCategory, parseLocale } from "@/lib/invoice-templates/print-context-query";
import type { IOrder } from "@/types";

/**
 * GET /api/vendor/orders/[id]/print-context?category=&consignmentId=&locale=
 *
 * The vendor's own consignment of an order, with the vendor's store identity
 * as the printing business (§4.7.1), and the template that applies: the
 * vendor's default once Phase 7 lets them have one, otherwise the platform's
 * (D-07), or null for the legacy print.
 *
 * The vendor is the signed-in user's own approved store (never an id from the
 * request); an order without their consignment, or a consignment that is not
 * theirs, is a 404. Vendor-created staff print through the staff order pages.
 *
 * The order's staff-only internal note never leaves here (§4.14): a seller's
 * view of an order leaves it out, so their prints do too.
 */
export const GET = withApi<{ id: string }>({ auth: "user" }, async ({ request, params, session }) => {
  await assertVendorPermission(
    session.user,
    VENDOR_PERMISSIONS.VIEW_ORDERS,
    "You do not have permission to view orders",
  );
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
  const vendor = await requireApprovedVendorByUserId(session.user.id);

  const query = new URL(request.url).searchParams;
  const category = parseCategory(query.get("category"));
  const consignmentId = query.get("consignmentId");
  const requestedLocale = parseLocale(query.get("locale"));
  if (!isValidObjectId(params.id)) return notFoundResponse("Order");
  if (consignmentId && !isValidObjectId(consignmentId)) return notFoundResponse("Consignment");

  const order = await Order.findOne({ _id: params.id, "subOrders.vendorId": vendor._id }).lean<IOrder>();
  if (!order) return notFoundResponse("Order");

  const consignmentIds = selectConsignments(order, { consignmentId, vendorIds: [String(vendor._id)] });
  if (!consignmentIds) return notFoundResponse("Consignment");

  const owner = vendorOwner(String(vendor._id));
  const template = await resolveDefault(owner, category);
  const context = await buildOrderContext(order, {
    category,
    owner,
    consignmentIds,
    locale: requestedLocale ?? template?.locale ?? "en",
    // Never the staff-only note (§4.14), whatever the template binds or the query asks.
    internalNote: false,
  });
  return successResponse({ template, context });
});
