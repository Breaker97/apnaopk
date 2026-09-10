import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { ORDER_STATUS, USER_ROLES } from "@/config/app.config";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { isValidObjectId, validateOptionalBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffOrderScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import {
  PREORDER_ITEM_STATUS,
  PURCHASE_TYPE,
  consumePreorderStockOnReady,
  releaseOrderPreorders,
} from "@/lib/orders/preorders";
import { restoreOrderInventory } from "@/lib/orders/order-inventory";
import { reverseCouponUsageForOrder } from "@/lib/catalog/coupons";
import { notifyPreorderCustomerUpdate } from "@/lib/notifications/notifications";
import { getPreorderBalanceDue } from "@/lib/orders/order-payment-status";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";

const PreorderActionSchema = z.object({
  action: z.enum(["ready", "payment_due", "cancel", "delay"]).optional(),
  releaseDate: z.string().max(40).optional(),
  reason: z.string().max(1000).optional(),
});

export const PUT = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:preorders:update",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Pre-order");

    const body = await validateOptionalBody(request, PreorderActionSchema);

    const scopeQuery = mergeScopeFilter(
      { _id: id, hasPreorder: true },
      buildStaffOrderScopeFilter(access.staffScope),
    );
    const before = await Order.findOne(scopeQuery).lean();
    if (!before) return notFoundResponse("Pre-order");

    // A cancelled pre-order already had its stock restored and quota released
    // — flipping it to ready/processing would ship units that are back in
    // sellable stock (and a later cancel would restore nothing, the claim
    // flags are spent).
    if (
      body.action !== "cancel" &&
      before.status === ORDER_STATUS.CANCELLED
    ) {
      throw new ValidationError(
        "This pre-order has been cancelled and can no longer be updated",
      );
    }

    if (body.action === "ready" || body.action === "payment_due") {
      // Zero once the balance has been recorded as paid — the raw figure
      // stays on the order for good and would re-request money already in.
      const outstandingAmount = getPreorderBalanceDue(before);
      const shouldRequestPayment =
        body.action === "payment_due" || outstandingAmount > 0;
      const nextOrderStatus = shouldRequestPayment
        ? ORDER_STATUS.PREORDERED
        : ORDER_STATUS.PROCESSING;
      const nextPreorderStatus = shouldRequestPayment
        ? PREORDER_ITEM_STATUS.PAYMENT_DUE
        : PREORDER_ITEM_STATUS.READY;

      // "Ready" means the received units physically exist: consume them and
      // free the shared reservation counter BEFORE transitioning (mirrors the
      // bulk endpoint — without this, the received stock stayed sellable
      // online while also being committed to this pre-order). Insufficient
      // stock aborts the transition so the admin can restock first.
      if (!shouldRequestPayment) {
        const outcome = await consumePreorderStockOnReady(id);
        if (!outcome.consumed && !outcome.alreadyConsumed) {
          throw new ValidationError(
            outcome.error || "Failed to allocate stock for this pre-order",
          );
        }
      }

      const order = await Order.findOneAndUpdate(
        // Status guard closes the race with a concurrent cancel — without it
        // this update would resurrect a just-cancelled order.
        { ...scopeQuery, status: { $ne: ORDER_STATUS.CANCELLED } },
        {
          $set: {
            status: nextOrderStatus,
            preorderStatus: nextPreorderStatus,
            statusChangedBy: session.user.id,
            ...(shouldRequestPayment ? {} : { processingAt: new Date() }),
            "items.$[item].preorderStatus": nextPreorderStatus,
            "subOrders.$[].status": nextOrderStatus,
            "subOrders.$[].items.$[subItem].preorderStatus":
              nextPreorderStatus,
          },
        },
        {
          new: true,
          arrayFilters: [
            { "item.purchaseType": PURCHASE_TYPE.PREORDER },
            { "subItem.purchaseType": PURCHASE_TYPE.PREORDER },
          ],
        },
      );
      if (!order) {
        // A concurrent cancel won after stock was consumed — put it back
        // (claim-based, no-ops if the cancel's own restore already ran).
        if (!shouldRequestPayment) {
          await restoreOrderInventory(id).catch((err) =>
            console.error(
              "Failed to restore preorder stock after lost ready/cancel race:",
              err,
            ),
          );
        }
        return notFoundResponse("Pre-order");
      }
      await notifyPreorderCustomerUpdate(
        String(order.customerId),
        order.orderNumber,
        shouldRequestPayment ? "payment_due" : "ready",
        String(order._id),
        {
          releaseDate: order.preorderReleaseDate,
          outstandingAmount,
        },
      ).catch((err) =>
        console.error("Failed to notify preorder customer:", err),
      );
      return successResponse(order);
    }

    if (body.action === "delay") {
      const releaseDate = body.releaseDate ? new Date(body.releaseDate) : null;
      if (!releaseDate || Number.isNaN(releaseDate.getTime())) {
        throw new ValidationError("A valid release date is required");
      }
      const reason =
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim().slice(0, 500)
          : undefined;
      const previousReleaseDate = before.preorderReleaseDate;

      const order = await Order.findOneAndUpdate(
        scopeQuery,
        {
          $set: {
            preorderStatus: PREORDER_ITEM_STATUS.DELAYED,
            preorderReleaseDate: releaseDate,
            preorderOriginalReleaseDate:
              before.preorderOriginalReleaseDate ||
              before.preorderReleaseDate ||
              releaseDate,
            preorderDelayReason: reason,
            preorderReleaseDateUpdatedAt: new Date(),
            preorderCustomerNotifiedAt: new Date(),
            statusChangedBy: session.user.id,
            "items.$[item].preorderReleaseDate": releaseDate,
            "items.$[item].preorderStatus": PREORDER_ITEM_STATUS.DELAYED,
            "subOrders.$[].items.$[subItem].preorderReleaseDate": releaseDate,
            "subOrders.$[].items.$[subItem].preorderStatus":
              PREORDER_ITEM_STATUS.DELAYED,
          },
        },
        {
          new: true,
          arrayFilters: [
            { "item.purchaseType": PURCHASE_TYPE.PREORDER },
            { "subItem.purchaseType": PURCHASE_TYPE.PREORDER },
          ],
        },
      );
      if (!order) return notFoundResponse("Pre-order");
      await notifyPreorderCustomerUpdate(
        String(order.customerId),
        order.orderNumber,
        "delayed",
        String(order._id),
        {
          releaseDate,
          previousReleaseDate,
          reason,
        },
      ).catch((err) =>
        console.error("Failed to notify preorder delay customer:", err),
      );
      return successResponse(order);
    }

    if (body.action === "cancel") {
      const canCancel =
        session.user.role === USER_ROLES.ADMIN ||
        !access.staffPermissions ||
        access.staffPermissions.includes(STAFF_PERMISSIONS.DELETE_ORDERS) ||
        access.staffPermissions.includes(STAFF_PERMISSIONS.MANAGE_ORDERS);
      if (!canCancel) {
        throw new AuthorizationError("You do not have permission to cancel orders");
      }

      const order = await Order.findOneAndUpdate(
        scopeQuery,
        {
          $set: {
            status: ORDER_STATUS.CANCELLED,
            preorderStatus: PREORDER_ITEM_STATUS.CANCELLED,
            cancelledAt: new Date(),
            statusChangedBy: session.user.id,
            "items.$[item].preorderStatus": PREORDER_ITEM_STATUS.CANCELLED,
            "subOrders.$[].status": ORDER_STATUS.CANCELLED,
            "subOrders.$[].items.$[subItem].preorderStatus":
              PREORDER_ITEM_STATUS.CANCELLED,
          },
        },
        {
          new: true,
          arrayFilters: [
            { "item.purchaseType": PURCHASE_TYPE.PREORDER },
            { "subItem.purchaseType": PURCHASE_TYPE.PREORDER },
          ],
        },
      );
      if (!order) return notFoundResponse("Pre-order");

      // If the pre-order was already marked ready, its stock was consumed
      // (sub-orders carry inventoryReserved) — put those units back. The
      // helper claims per sub-order, so never-consumed orders are a no-op.
      await restoreOrderInventory(id).catch((err) =>
        console.error("Failed to restore preorder inventory on cancel:", err),
      );
      await releaseOrderPreorders(id).catch((err) =>
        console.error("Failed to release preorder quota:", err),
      );
      await reverseCouponUsageForOrder(id).catch((err) =>
        console.error("Failed to reverse coupon usage:", err),
      );
      await notifyPreorderCustomerUpdate(
        String(order.customerId),
        order.orderNumber,
        "cancelled",
        String(order._id),
        { releaseDate: order.preorderReleaseDate },
      ).catch((err) =>
        console.error("Failed to notify preorder cancellation customer:", err),
      );
      return successResponse(order);
    }

    throw new ValidationError("Unsupported preorder action");
  },
);
