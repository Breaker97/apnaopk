import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import {
  assertAdminOrStaffPermissions,
  assertVendorStaffMayChangeOrderById,
} from "@/lib/access/staff-authz";
import { buildStaffOrderScopeFilter, mergeScopeFilter } from "@/lib/access/staff-scope";
import { createAuditContext } from "@/lib/audit";
import { CheckoutAddressSchema } from "@/lib/validations";
import { changeOrderShippingAddress } from "@/lib/orders/order-address";

const BodySchema = z.object({
  address: CheckoutAddressSchema,
  /** Save an address the courier's check could not confirm; the hold stays. */
  force: z.boolean().optional(),
});

/**
 * POST /api/admin/orders/[id]/address
 *
 * Staff correcting the delivery address on an order that has not shipped. An
 * address that passes the courier's check releases an address hold.
 */
export const POST = withApi<{ id: string }>(
  { auth: "user", demo: "block-mutations" },
  async ({ request, params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
    );
    if (!isValidObjectId(params.id)) return notFoundResponse("Order");
    const { address, force } = await validateBody(request, BodySchema);
    await assertVendorStaffMayChangeOrderById(access, params.id);

    const result = await changeOrderShippingAddress({
      orderFilter: mergeScopeFilter(
        { _id: params.id },
        buildStaffOrderScopeFilter(access.staffScope),
      ),
      address,
      by: "store",
      force,
      auditContext: createAuditContext(request, session),
      actorId: session.user.id,
    });
    if (!result) return notFoundResponse("Order");

    return successResponse(
      result.saved
        ? { saved: true, released: result.released, verification: result.verification }
        : { saved: false, verification: result.verification },
      result.saved
        ? "Delivery address updated"
        : result.verification.checkedWith === "carrier"
          ? "The courier can't find this address"
          : "Check this address",
    );
  },
);
