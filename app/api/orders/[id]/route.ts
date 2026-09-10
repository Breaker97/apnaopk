import { Order } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { AuthorizationError } from "@/lib/api/errors";
import { restoreOrderInventory } from "@/lib/orders/order-inventory";
import { releaseOrderPreorders } from "@/lib/orders/preorders";
import { reverseCouponUsageForOrder } from "@/lib/catalog/coupons";
import { auditOrderCancelled, customerActor } from "@/lib/orders/audit-order";
import { withApi } from "@/lib/api/handler";
import { ORDER_STATUS } from "@/config/app.config";
import {
  buildOrderStatusUpdates,
  subOrderUpdateOptions,
} from "@/lib/orders/order-status-apply";
import { reconcileOrderStatus } from "@/lib/orders/order-status-reconcile";
import { sanitizeOrderForCustomer } from "@/lib/orders/order-customer-view";
import { loadOrderShipmentTracking } from "@/lib/orders/order-shipment-view";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

/**
 * GET /api/orders/[id]
 * Get a single order by ID
 */
const CustomerOrderUpdateSchema = z.object({
  status: z.string().max(50).optional(),
});

export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ params, session }) => {
    const { id } = params;
    const order = await Order.findOne({
      _id: id,
      customerId: session.user.id,
    }).lean();

    if (!order) {
      return notFoundResponse("Order");
    }

    // The same parcel view the public tracking page renders. Without it this
    // screen could only ever print a bare AWB — and on a single-vendor order,
    // where `sanitizeOrderForCustomer` deliberately returns no consignments,
    // it printed nothing at all: the signed-in customer saw strictly less
    // about their own parcel than someone typing the order number into the
    // public form.
    const sanitized = await sanitizeOrderForCustomer(order);
    const tracking = await loadOrderShipmentTracking({
      orderId: order._id,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
    });

    return successResponse({
      ...sanitized,
      trackingUrl: tracking.primary.trackingUrl,
      trackingEvents: tracking.primary.events,
      trackingException: tracking.primary.exception,
      subOrders: sanitized.subOrders.map((consignment) => {
        const parcel = tracking.forTrackingNumber(
          consignment.trackingNumber,
          consignment.carrier,
        );
        return {
          ...consignment,
          carrier: consignment.carrier || parcel.carrierName,
          trackingUrl: parcel.trackingUrl,
          events: parcel.events,
          exception: parcel.exception,
        };
      }),
    });
  },
);

/**
 * PUT /api/orders/[id]
 * Update order (customer can only cancel pending orders)
 */
export const PUT = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const { id } = params;
    const body = await validateBody(request, CustomerOrderUpdateSchema);

    // Selects `status` rather than using `exists`, so the audit entry below can
    // name the status the order was cancelled FROM. Same query, same cost.
    const existing = await Order.findOne({
      _id: id,
      customerId: session.user.id,
    })
      .select("status")
      .lean();

    if (!existing) {
      return notFoundResponse("Order");
    }

    // Customers can only cancel pending orders
    if (body.status === "cancelled") {
      // Built from the shared cascade so a customer cancelling writes exactly
      // what an admin cancelling writes. It previously used a bare `$[]`,
      // which addresses EVERY sub-order unconditionally — on a split order
      // where one vendor had already handed the goods over, that erased the
      // delivery and, until the same change fixed it, restocked the units.
      const updates = {
        ...buildOrderStatusUpdates({ status: ORDER_STATUS.CANCELLED }),
        cancelReason: "Cancelled by customer",
      };

      // Atomic status guard: the cancellable status is part of the filter, so a
      // concurrent admin transition (e.g. pending -> shipped) makes this write
      // match nothing instead of regressing a shipped order to cancelled.
      const order = await Order.findOneAndUpdate(
        {
          _id: id,
          customerId: session.user.id,
          status: { $in: [ORDER_STATUS.PENDING, ORDER_STATUS.PREORDERED] },
        },
        { $set: updates },
        { new: true, ...subOrderUpdateOptions(updates) },
      );

      if (!order) {
        throw new AuthorizationError("You can only cancel pending orders");
      }

      // A split order whose other vendor had already shipped is not cancelled
      // just because this half is — see `reconcileOrderStatus`.
      const reconciled = await reconcileOrderStatus(order).catch((err) => {
        console.error("Failed to reconcile status on customer cancel:", err);
        return null;
      });
      if (reconciled) order.status = reconciled;

      // Restore inventory only for sub-orders that actually had a reservation.
      // For abandoned PayPal/Razorpay/Paystack pending orders no decrement
      // ever happened, so this safely no-ops.
      await restoreOrderInventory(String(order._id)).catch((err) =>
        console.error("Failed to restore inventory on customer cancel:", err),
      );
      await releaseOrderPreorders(String(order._id)).catch((err) =>
        console.error("Failed to release preorder quota on customer cancel:", err),
      );

      // Only when the whole order actually went. If a co-vendor's parcel
      // survived the cancellation, the customer is still receiving goods they
      // bought with that discount — same rule as the admin route.
      if (order.status === ORDER_STATUS.CANCELLED) {
        await reverseCouponUsageForOrder(String(order._id)).catch((err) =>
          console.error(
            "Failed to reverse coupon usage on customer cancel:",
            err,
          ),
        );
      }

      // A customer cancelling their own order restocked inventory, released
      // preorder quota and reversed a coupon — and left no trace on the order.
      await auditOrderCancelled(customerActor(request, session), order, {
        from: String(existing.status),
        by: "customer",
      });

      return successResponse(await sanitizeOrderForCustomer(order.toObject()));
    }

    throw new AuthorizationError("You can only cancel pending orders");
  },
);

