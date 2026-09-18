import { z } from "zod";
import { Order } from "@/models";
import { withApi } from "@/lib/api/handler";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffOrderScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { resolvePickupLifecycleUpdate } from "@/lib/checkout/pickup-fulfillment";
import { auditUpdate, createAuditContext } from "@/lib/audit";
import { notifyOrderStatus } from "@/lib/notifications/notifications";
import { saveOrderOverReadStatuses } from "@/lib/orders/order-save-guard";

const PickupLifecycleSchema = z.object({
  action: z.enum(["ready", "collected"]),
});

/**
 * POST /api/admin/orders/[id]/pickup
 *
 * Moves a pickup through scheduled → ready → collected from the admin side.
 *
 * The vendor dashboard has had this for a while, but that dashboard is
 * unreachable unless multi-vendor mode is on — so on a default single-vendor
 * install a shop could take a pickup order and then had no way to mark it
 * handed over. This is the same lifecycle, reached by whoever runs the store.
 */
export const POST = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:orders:pickup-update",
      "moderate",
      session.user.role,
    );

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Order");

    const { action } = await validateBody(request, PickupLifecycleSchema);

    const order = await Order.findOne(
      mergeScopeFilter(
        { _id: id },
        buildStaffOrderScopeFilter(access.staffScope),
      ),
    );
    if (!order) return notFoundResponse("Order");

    // Pickup lives on the sub-order, because that is the fulfillment unit. On a
    // single-vendor store there is exactly one; on a marketplace this is the
    // one that was actually collected.
    const subOrderIndex = order.subOrders.findIndex(
      (candidate: { fulfillment?: { method?: string } }) =>
        candidate.fulfillment?.method === "pickup",
    );
    if (subOrderIndex < 0) {
      throw new ValidationError("This order has no pickup to update");
    }

    const subOrder = order.subOrders[subOrderIndex];
    const pickup = subOrder.fulfillment?.pickup;
    if (!pickup) {
      throw new ValidationError("This order has no pickup to update");
    }

    const before = order.toObject() as unknown as Record<string, unknown>;

    let update;
    try {
      update = resolvePickupLifecycleUpdate({
        action,
        pickupStatus: pickup.status,
        orderStatus: subOrder.status,
      });
    } catch (error) {
      throw new ValidationError(
        error instanceof Error ? error.message : "Pickup cannot be updated",
      );
    }

    pickup.status = update.pickupStatus;
    if (update.readyAt) pickup.readyAt = update.readyAt;
    if (update.collectedAt) pickup.collectedAt = update.collectedAt;
    subOrder.status = update.subOrderStatus;
    if (update.deliveredAt) subOrder.deliveredAt = update.deliveredAt;

    // Mirror the roll-up the vendor route applies, so an order's own status
    // never disagrees with the sub-orders it is made of.
    const statuses = order.subOrders.map(
      (candidate: { status: string }) => candidate.status,
    );
    if (new Set(statuses).size === 1) {
      order.status = statuses[0];
    } else if (
      statuses.every((status: string) =>
        ["delivered", "cancelled"].includes(status),
      )
    ) {
      order.status = "delivered";
    } else if (statuses.some((status: string) => status === "processing")) {
      order.status = "processing";
    }

    // Only over the order as it was read, as the seller's pickup route does: a
    // counter handover saved over a cancellation that landed in the meantime
    // hands over goods the shopper was refunded for.
    await saveOrderOverReadStatuses(
      order,
      before as { status?: string; subOrders?: Array<{ status?: string }> },
    );

    // The shopper hears about the ORDER, and only when the order moved: one
    // consignment collected at the counter is not "your order was delivered"
    // while another seller's parcel is still coming.
    const wasOrderStatus = String((before as { status?: string }).status || "");
    if (String(order.status) !== wasOrderStatus) {
      await notifyOrderStatus({
        orderId: String(order._id),
        status: String(order.status),
      }).catch((error) =>
        console.error("Failed to notify customer about pickup update:", error),
      );
    }

    await auditUpdate(
      createAuditContext(request, session),
      "order",
      id,
      before,
      order.toObject() as unknown as Record<string, unknown>,
    );

    return successResponse(order);
  },
);
