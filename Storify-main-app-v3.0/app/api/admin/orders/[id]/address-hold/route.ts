import * as z from "zod";
import { Order } from "@/models";
import { withApi } from "@/lib/api/handler";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import {
  assertAdminOrStaffPermissions,
  assertVendorStaffMayChangeOrderById,
} from "@/lib/access/staff-authz";
import { buildStaffOrderScopeFilter, mergeScopeFilter } from "@/lib/access/staff-scope";
import { createAuditContext } from "@/lib/audit";
import {
  extendAddressHold,
  placeAddressHold,
  releaseAddressHold,
  requestAddressCorrection,
} from "@/lib/orders/address-hold";

const BodySchema = z.discriminatedUnion("action", [
  /** Email the customer the correction link (again). */
  z.object({ action: z.literal("request") }),
  /** The store confirms the address is right: ship anyway. */
  z.object({ action: z.literal("release"), note: z.string().trim().max(300).optional() }),
  /** Give the customer more days. */
  z.object({ action: z.literal("extend"), days: z.number().int().min(1).max(60) }),
  /** Put an order on hold by hand — a returned parcel, a call from the courier. */
  z.object({ action: z.literal("hold"), message: z.string().trim().min(3).max(300) }),
]);

/**
 * POST /api/admin/orders/[id]/address-hold
 *
 * What staff can do about an undeliverable address, beyond editing it.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    demo: "block-mutations",
    // "request" and "extend" each email the customer.
    rateLimit: { action: "admin:order-address-hold", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
    );
    if (!isValidObjectId(params.id)) return notFoundResponse("Order");
    const body = await validateBody(request, BodySchema);

    const exists = await Order.exists(
      mergeScopeFilter({ _id: params.id }, buildStaffOrderScopeFilter(access.staffScope)),
    );
    if (!exists) return notFoundResponse("Order");
    await assertVendorStaffMayChangeOrderById(access, params.id);

    const actor = { id: session.user.id, context: createAuditContext(request, session) };

    switch (body.action) {
      case "request": {
        const result = await requestAddressCorrection({ orderId: params.id, actor });
        if (!result.sent) throw new ValidationError("This order isn't on an address hold");
        return successResponse(result, "Address request sent to the customer");
      }
      case "release": {
        const result = await releaseAddressHold({
          orderId: params.id,
          reason: "store_confirmed",
          actor,
          summary: body.note
            ? `Address hold released — staff confirmed the address is correct: ${body.note}`
            : undefined,
        });
        if (!result.released) throw new ValidationError("This order isn't on an address hold");
        return successResponse(result, "Shipping resumed");
      }
      case "extend": {
        const result = await extendAddressHold({ orderId: params.id, days: body.days, actor });
        if (!result.extended) throw new ValidationError("This order isn't on an address hold");
        return successResponse(result, `Deadline extended by ${body.days} days`);
      }
      case "hold": {
        const result = await placeAddressHold({
          orderId: params.id,
          reason: "store",
          message: body.message,
          actor,
        });
        if (!result.placed) {
          throw new ValidationError(
            "This order can't be put on hold — it is already on hold, shipped, cancelled or has nothing to deliver",
          );
        }
        return successResponse(result, "Shipping put on hold");
      }
    }
  },
);
