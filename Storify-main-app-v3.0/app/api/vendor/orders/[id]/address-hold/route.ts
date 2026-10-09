import * as z from "zod";
import { Order } from "@/models";
import { withApi } from "@/lib/api/handler";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { createAuditContext } from "@/lib/audit";
import { requestAddressCorrection } from "@/lib/orders/address-hold";

const BodySchema = z.object({ action: z.literal("request") });

/**
 * POST /api/vendor/orders/[id]/address-hold
 *
 * A seller re-sending the address request on an order they have a consignment
 * in. Releasing a hold or editing the address is the store's decision — the
 * address belongs to the whole order, not to one seller's parcel.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    demo: "block-mutations",
    // Every call emails the customer from the store's own address; a seller
    // must not be able to use that to flood somebody's inbox.
    rateLimit: { action: "vendor:order-address-request", preset: "strict" },
  },
  async ({ request, params, session }) => {
    await validateBody(request, BodySchema);
    const allowed = await hasVendorPermission(session.user, VENDOR_PERMISSIONS.EDIT_ORDERS);
    if (!allowed && !isAdmin(session.user)) throw new AuthorizationError();
    if (!isValidObjectId(params.id)) return notFoundResponse("Order");

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    const exists = await Order.exists({ _id: params.id, "subOrders.vendorId": vendor._id });
    if (!exists) return notFoundResponse("Order");

    const result = await requestAddressCorrection({
      orderId: params.id,
      actor: { id: session.user.id, context: createAuditContext(request, session) },
    });
    if (!result.sent) throw new ValidationError("This order isn't on an address hold");
    return successResponse(result, "Address request sent to the customer");
  },
);
