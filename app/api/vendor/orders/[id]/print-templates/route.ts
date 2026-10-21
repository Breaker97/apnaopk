import { Order } from "@/models";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { assertVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { vendorOwner } from "@/lib/invoice-templates/owner";
import { defaultCategories } from "@/lib/invoice-templates/service";

/**
 * GET /api/vendor/orders/[id]/print-templates
 *
 * Which categories the vendor's order page prints with a template:
 * `{ online, pos, sticker }` by the vendor's chain (their own default once
 * Phase 7 allows one, else the platform's, D-07). The same access as the
 * vendor `print-context`: the signed-in owner's approved store, multi-vendor
 * on, an order holding their consignment (else 404). Reads only.
 */
export const GET = withApi<{ id: string }>({ auth: "user" }, async ({ params, session }) => {
  await assertVendorPermission(session.user, VENDOR_PERMISSIONS.VIEW_ORDERS, "You do not have permission to view orders");
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
  const vendor = await requireApprovedVendorByUserId(session.user.id);
  if (!isValidObjectId(params.id)) return notFoundResponse("Order");
  const order = await Order.findOne({ _id: params.id, "subOrders.vendorId": vendor._id }).select("_id").lean();
  if (!order) return notFoundResponse("Order");
  return successResponse(await defaultCategories(vendorOwner(String(vendor._id))));
});
