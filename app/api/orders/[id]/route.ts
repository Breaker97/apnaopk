import { Order } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { AuthorizationError } from "@/lib/api/errors";
import { customerActor } from "@/lib/orders/audit-order";
import { cancelOrderForCustomer } from "@/lib/orders/customer-cancel";
import { withApi } from "@/lib/api/handler";
import { sanitizeOrderForCustomer } from "@/lib/orders/order-customer-view";
import { loadOrderShipmentTracking } from "@/lib/orders/order-shipment-view";
import { getOrderReviewStates } from "@/lib/catalog/review-eligibility";
import {
  getPreorderBalanceDeadline,
  getPreorderBalanceDue,
  getPreorderPaidSoFar,
} from "@/lib/orders/order-payment-status";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import { getSettings } from "@/models/settings.model";
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
    const [sanitized, tracking, reviewStates] = await Promise.all([
      sanitizeOrderForCustomer(order),
      loadOrderShipmentTracking({
        orderId: order._id,
        trackingNumber: order.trackingNumber,
        carrier: order.carrier,
      }),
      getOrderReviewStates(session.user.id, order),
    ]);

    // These are computed here rather than in the browser because the
    // sanitizer deliberately strips sub-order items — the very lines that say
    // which part of the balance belongs to a cancelled consignment — and the
    // grace period lives in store settings the shopper never sees.
    const preorderBalance = order.hasPreorder
      ? await (async () => {
          const settings = await getSettings();
          const deadline = getPreorderBalanceDeadline(
            order,
            resolvePreorderPolicy(settings.preorder).expiryGraceDays,
          );
          return {
            preorderBalanceDue: getPreorderBalanceDue(order),
            preorderPaidSoFar: getPreorderPaidSoFar(order),
            preorderBalanceDeadline: deadline ? deadline.toISOString() : undefined,
          };
        })()
      : null;

    return successResponse({
      ...sanitized,
      ...(preorderBalance ?? {}),
      reviewStates,
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

    // Customers can only cancel pending orders. The whole cascade — status,
    // stock, quota, coupon, audit, refund — lives in `cancelOrderForCustomer`,
    // shared with the guest cancel a pre-order's manage link offers, so the two
    // can never disagree about what a cancellation does.
    if (body.status === "cancelled") {
      const result = await cancelOrderForCustomer({
        orderFilter: { _id: id, customerId: session.user.id },
        auditContext: customerActor(request, session),
        createdBy: session.user.id,
      });
      if (!result) return notFoundResponse("Order");

      return successResponse({
        ...(await sanitizeOrderForCustomer(result.order.toObject())),
        ...(result.refund ? { refund: result.refund } : {}),
      });
    }

    // Anything but a cancel is refused — but only for an order this shopper
    // actually owns, so the answer never confirms that someone else's exists.
    const owned = await Order.exists({ _id: id, customerId: session.user.id });
    if (!owned) return notFoundResponse("Order");
    throw new AuthorizationError("You can only cancel pending orders");
  },
);

