import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { assertVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { resolvePickupLifecycleUpdate } from "@/lib/checkout/pickup-fulfillment";
import { rollUpOrderStatus } from "@/lib/orders/order-status-apply";
import {
  getFulfillmentPaymentBlock,
  isFulfillmentTransition,
} from "@/lib/orders/fulfillment-payment-gate";
import { toVendorOrderView } from "@/lib/vendors/vendor-order-view";
import { auditUpdate, createAuditContext } from "@/lib/audit";
import { notifyOrderStatus } from "@/lib/notifications/notifications";
import { withApi } from "@/lib/api/handler";

const PickupLifecycleSchema = z.object({
  action: z.enum(["ready", "collected"]),
});

/**
 * POST /api/vendor/orders/[id]/pickup
 * Moves a vendor-owned pickup through scheduled -> ready -> collected.
 */
export const POST = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.EDIT_ORDERS,
      "You do not have permission to edit orders",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:orders:pickup-update",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    if (!vendor) throw new AuthorizationError("Vendor profile not found");

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Order");
    const { action } = await validateBody(request, PickupLifecycleSchema);

    const order = await Order.findOne({
      _id: id,
      "subOrders.vendorId": vendor._id,
    });
    if (!order) return notFoundResponse("Order");

    const subOrderIndex = order.subOrders.findIndex(
      (subOrder: { vendorId?: { toString(): string } }) =>
        subOrder.vendorId?.toString() === vendor._id.toString(),
    );
    if (subOrderIndex < 0) return notFoundResponse("Sub-order");

    const subOrder = order.subOrders[subOrderIndex];
    const pickup = subOrder.fulfillment?.pickup;
    if (subOrder.fulfillment?.method !== "pickup" || !pickup) {
      throw new ValidationError("This sub-order is not a pickup order");
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

    // A counter handover is fulfilment like any other: the shopper does not
    // walk out with goods their gateway payment never paid for.
    if (isFulfillmentTransition(update.subOrderStatus)) {
      const blocked = getFulfillmentPaymentBlock(order, subOrder);
      if (blocked) throw new ValidationError(blocked);
    }

    pickup.status = update.pickupStatus;
    if (update.readyAt) pickup.readyAt = update.readyAt;
    if (update.collectedAt) pickup.collectedAt = update.collectedAt;
    subOrder.status = update.subOrderStatus;
    if (update.deliveredAt) subOrder.deliveredAt = update.deliveredAt;

    // Same roll-up the delivery route applies, from the same helper: a counter
    // collection is one consignment completing, and an order with a sibling
    // still packing has not completed.
    const derivedStatus = rollUpOrderStatus(order.status, order.subOrders);
    if (derivedStatus) order.status = derivedStatus;

    // Only over the order as it was read — see the same guard on the delivery
    // route: a counter handover saved over a cancellation that landed in the
    // meantime would hand over goods the shopper was refunded for.
    const readStatuses: Record<string, unknown> = {
      status: (before as { status?: string }).status,
    };
    (
      ((before as { subOrders?: Array<{ status?: string }> }).subOrders || [])
    ).forEach((sub, index) => {
      readStatuses[`subOrders.${index}.status`] = sub.status;
    });
    (order as unknown as { $where?: Record<string, unknown> }).$where =
      readStatuses;
    try {
      await order.save();
    } catch (err) {
      if ((err as { name?: string })?.name === "DocumentNotFoundError") {
        throw new ConflictError(
          "This order changed while you were updating it. Refresh the page and try again.",
        );
      }
      throw err;
    }

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

    return successResponse(toVendorOrderView(order, vendor._id));
  },
);
