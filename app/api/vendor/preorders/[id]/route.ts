import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { ORDER_STATUS } from "@/config/app.config";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { isValidObjectId, validateOptionalBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  PREORDER_ITEM_STATUS,
  PURCHASE_TYPE,
  consumePreorderStockOnReady,
  releaseSubOrderPreorders,
} from "@/lib/orders/preorders";
import { restoreSubOrderInventory } from "@/lib/orders/order-inventory";
import { reverseCouponUsageForOrder } from "@/lib/catalog/coupons";
import { notifyPreorderCustomerUpdate } from "@/lib/notifications/notifications";
import { getPreorderBalanceDue } from "@/lib/orders/order-payment-status";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";

const VendorPreorderActionSchema = z.object({
  action: z.enum(["ready", "cancel"]).optional(),
});

export const PUT = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const user = session.user;
    const canEdit = await hasVendorPermission(
      user,
      VENDOR_PERMISSIONS.EDIT_ORDERS,
    );
    const canManage = canEdit
      ? true
      : await hasVendorPermission(user, VENDOR_PERMISSIONS.MANAGE_ORDERS);
    if (!canEdit && !canManage && !isAdmin(user)) {
      throw new AuthorizationError("You do not have permission to edit orders");
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:preorders:update",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    const vendor = await requireApprovedVendorByUserId(session.user.id);
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Pre-order");

    const body = await validateOptionalBody(request, VendorPreorderActionSchema);

    const order = await Order.findOne({
      _id: id,
      hasPreorder: true,
      "subOrders.vendorId": vendor._id,
    });
    if (!order) return notFoundResponse("Pre-order");

    const subOrder = order.subOrders.find(
      (sub: { vendorId?: { toString: () => string } }) =>
        sub.vendorId?.toString() === vendor._id.toString(),
    );
    if (!subOrder) return notFoundResponse("Pre-order");

    if (body.action === "ready") {
      // A cancelled order/sub-order already had its stock restored and quota
      // released — marking it ready would ship units that are back in
      // sellable stock (the claim flags are spent, a later cancel restores
      // nothing).
      if (
        order.status === ORDER_STATUS.CANCELLED ||
        subOrder.status === ORDER_STATUS.CANCELLED
      ) {
        throw new ValidationError(
          "This pre-order has been cancelled and can no longer be marked ready",
        );
      }
      const outstandingAmount = getPreorderBalanceDue(order);
      const nextPreorderStatus =
        outstandingAmount > 0
          ? PREORDER_ITEM_STATUS.PAYMENT_DUE
          : PREORDER_ITEM_STATUS.READY;

      // "Ready" means this vendor's received units physically exist: consume
      // them and free the shared reservation counter BEFORE transitioning,
      // scoped to this vendor's sub-order only (mirrors the admin endpoints).
      // Insufficient stock aborts the transition so the vendor restocks first.
      if (outstandingAmount <= 0) {
        const outcome = await consumePreorderStockOnReady(String(order._id), {
          vendorId: String(vendor._id),
        });
        if (!outcome.consumed && !outcome.alreadyConsumed) {
          throw new ValidationError(
            outcome.error || "Failed to allocate stock for this pre-order",
          );
        }
      }

      subOrder.status = ORDER_STATUS.PROCESSING;
      subOrder.items.forEach(
        (item: { purchaseType?: string; preorderStatus?: string }) => {
          if (item.purchaseType === PURCHASE_TYPE.PREORDER) {
            item.preorderStatus = nextPreorderStatus;
          }
        },
      );

      const statuses: string[] = order.subOrders.map(
        (sub: { status: string }) => sub.status,
      );
      if (statuses.every((status) => status === ORDER_STATUS.PROCESSING)) {
        order.status =
          outstandingAmount > 0 ? ORDER_STATUS.PREORDERED : ORDER_STATUS.PROCESSING;
        order.preorderStatus = nextPreorderStatus;
        order.items.forEach(
          (item: { purchaseType?: string; preorderStatus?: string }) => {
            if (item.purchaseType === PURCHASE_TYPE.PREORDER) {
              item.preorderStatus = nextPreorderStatus;
            }
          },
        );
      } else {
        order.preorderStatus = PREORDER_ITEM_STATUS.PARTIALLY_READY;
      }
      await order.save();
      await notifyPreorderCustomerUpdate(
        String(order.customerId),
        order.orderNumber,
        order.preorderStatus === PREORDER_ITEM_STATUS.PARTIALLY_READY
          ? "partially_ready"
          : outstandingAmount > 0
            ? "payment_due"
            : "ready",
        String(order._id),
        {
          releaseDate: order.preorderReleaseDate,
          outstandingAmount,
        },
      ).catch((err) =>
        console.error("Failed to notify preorder ready customer:", err),
      );
      return successResponse(order);
    }

    if (body.action === "cancel") {
      const canDelete = await hasVendorPermission(
        user,
        VENDOR_PERMISSIONS.DELETE_ORDERS,
      );
      if (!canDelete && !canManage && !isAdmin(user)) {
        throw new AuthorizationError("You do not have permission to cancel orders");
      }

      subOrder.status = ORDER_STATUS.CANCELLED;
      subOrder.items.forEach(
        (item: { purchaseType?: string; preorderStatus?: string }) => {
          if (item.purchaseType === PURCHASE_TYPE.PREORDER) {
            item.preorderStatus = PREORDER_ITEM_STATUS.CANCELLED;
          }
        },
      );

      const statuses: string[] = order.subOrders.map(
        (sub: { status: string }) => sub.status,
      );
      if (statuses.every((status) => status === ORDER_STATUS.CANCELLED)) {
        order.status = ORDER_STATUS.CANCELLED;
        order.preorderStatus = PREORDER_ITEM_STATUS.CANCELLED;
        order.cancelledAt = new Date();
        order.items.forEach(
          (item: { purchaseType?: string; preorderStatus?: string }) => {
            if (item.purchaseType === PURCHASE_TYPE.PREORDER) {
              item.preorderStatus = PREORDER_ITEM_STATUS.CANCELLED;
            }
          },
        );
      }
      await order.save();

      // If this vendor's sub-order was already marked ready, its stock was
      // consumed (inventoryReserved) — put those units back. Claim-based, so
      // a never-consumed sub-order is a no-op.
      await restoreSubOrderInventory({
        orderId: String(order._id),
        vendorId: String(vendor._id),
      }).catch((err) =>
        console.error(
          "Failed to restore vendor preorder inventory on cancel:",
          err,
        ),
      );
      await releaseSubOrderPreorders({
        orderId: String(order._id),
        vendorId: String(vendor._id),
      }).catch((err) =>
        console.error("Failed to release vendor preorder quota:", err),
      );
      if (order.status === ORDER_STATUS.CANCELLED) {
        await reverseCouponUsageForOrder(String(order._id)).catch((err) =>
          console.error("Failed to reverse coupon usage:", err),
        );
      }
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
