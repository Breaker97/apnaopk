import "server-only";

import { Order, Vendor } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import type { AuditContext } from "@/lib/audit";
import { auditOrderCancelled, auditOrderStatus } from "@/lib/orders/audit-order";
import { restoreSubOrderInventory } from "@/lib/orders/order-inventory";
import { releaseSubOrderPreorders } from "@/lib/orders/preorders";
import {
  DISPATCHED_ORDER_STATUSES,
  getOrderStatusActionByTarget,
  getOrderStatusTimestampUpdates,
} from "@/lib/orders/order-status-workflow";
import { rollUpOrderStatus } from "@/lib/orders/order-status-apply";
import { reverseCouponUsageForOrder } from "@/lib/catalog/coupons";
import { refundOrderCancellation } from "@/lib/orders/preorder-cancel-refund";
import { notifyOrderStatus } from "@/lib/notifications/notifications";
import { voidLabelsForCancellation } from "@/lib/shipping/cancel-labels";

/**
 * Calling off one seller's consignment on a split order, from the store side.
 *
 * Only the seller could do this before: an admin facing one out-of-stock or
 * unreachable seller had to cancel the whole order — refunding and restocking
 * every other seller's goods — or ask the seller to do it. This is the same
 * cancellation the seller's own screen makes, reached by whoever runs the
 * store: the consignment's stock goes back, its pre-order quota is released,
 * its share of the money is refunded to the shopper, and the order's status
 * is derived from what is left.
 *
 * A consignment already shipped or delivered is cancelled only on an override
 * — the goods have left, so nothing is restocked — and the whole-order paths
 * stay the way to cancel a single-consignment order.
 */
export interface ConsignmentCancellation {
  orderStatus: string;
  refund?: {
    refunded: boolean;
    amount?: number;
    currency?: string;
    reason?: string;
    gatewayCalled?: boolean;
  };
}

export async function cancelConsignment(params: {
  orderId: string;
  subOrderId: string;
  reason: string;
  /** A consignment that has already shipped may only be cancelled on purpose. */
  override?: boolean;
  actorUserId: string;
  actorLabel?: string;
  auditContext: AuditContext;
  /** Limits which orders this actor may reach (scoped staff). */
  scopeFilter?: Record<string, unknown>;
}): Promise<ConsignmentCancellation> {
  const order = await Order.findOne({ ...(params.scopeFilter || {}), _id: params.orderId });
  if (!order) throw new NotFoundError("Order");

  const index = order.subOrders.findIndex(
    (sub: { _id?: unknown }) => String(sub._id) === params.subOrderId,
  );
  if (index === -1) throw new NotFoundError("Consignment");

  const liveCount = order.subOrders.filter(
    (sub: { status?: string }) => sub.status !== ORDER_STATUS.CANCELLED,
  ).length;
  const subOrder = order.subOrders[index];
  const currentStatus = String(subOrder.status || ORDER_STATUS.PENDING);

  if (currentStatus === ORDER_STATUS.CANCELLED) {
    throw new ValidationError("This consignment is already cancelled");
  }
  if (order.subOrders.length < 2 || liveCount < 2) {
    throw new ValidationError(
      "This is the only consignment left on the order. Cancel the order instead.",
    );
  }

  const dispatched = DISPATCHED_ORDER_STATUSES.includes(currentStatus);
  if (!params.override && !getOrderStatusActionByTarget(currentStatus, ORDER_STATUS.CANCELLED)) {
    throw new ValidationError(
      `This consignment is ${currentStatus}, so it cannot be cancelled. An admin can override this.`,
    );
  }

  const vendor = await Vendor.findById(subOrder.vendorId)
    .select("storeName")
    .lean<{ storeName?: string } | null>();
  const seller = vendor?.storeName || "A seller";

  const before = order.toObject() as unknown as {
    status?: string;
    subOrders?: Array<{ status?: string }>;
  };
  const previousOrderStatus = String(before.status || "");

  subOrder.status = ORDER_STATUS.CANCELLED;
  const derived = rollUpOrderStatus(order.status, order.subOrders);
  if (derived) {
    Object.assign(order, getOrderStatusTimestampUpdates(derived));
    order.status = derived;
  }

  // Written only over the order as it was read — the same guard the seller's
  // screen uses — so a consignment that moved in the meantime is not
  // cancelled on the strength of a stale page.
  const readStatuses: Record<string, unknown> = { status: previousOrderStatus };
  (before.subOrders || []).forEach((sub, subIndex) => {
    readStatuses[`subOrders.${subIndex}.status`] = sub.status;
  });
  (order as unknown as { $where?: Record<string, unknown> }).$where = readStatuses;
  try {
    await order.save();
  } catch (error) {
    if ((error as { name?: string })?.name === "DocumentNotFoundError") {
      throw new ConflictError(
        "This order changed while you were updating it. Refresh the page and try again.",
      );
    }
    throw error;
  }

  const orderId = String(order._id);
  const vendorId = String(subOrder.vendorId);

  // Goods that left the warehouse are not back on the shelf.
  if (!dispatched) {
    await restoreSubOrderInventory({ orderId, vendorId }).catch((error) =>
      console.error("Failed to restore inventory for a cancelled consignment:", error),
    );
  }
  await releaseSubOrderPreorders({ orderId, vendorId }).catch((error) =>
    console.error("Failed to release pre-order quota for a cancelled consignment:", error),
  );

  // A label bought for goods that are staying put is money the store paid a
  // carrier for nothing. Only this consignment's, and only one never handed
  // over — the rest of the order is still being delivered.
  await voidLabelsForCancellation({ orderId, subOrderId: subOrder._id }).catch((error) =>
    console.error("Failed to void the labels of a cancelled consignment:", error),
  );

  if (order.status === ORDER_STATUS.CANCELLED && previousOrderStatus !== ORDER_STATUS.CANCELLED) {
    await reverseCouponUsageForOrder(orderId).catch((error) =>
      console.error("Failed to reverse coupon usage for a cancelled consignment:", error),
    );
  }

  // The shopper hears about the order's status only when the order's status
  // moved. The notice is written per status — "your order was cancelled" —
  // which would be false while the other sellers' items are still coming.
  if (order.status !== previousOrderStatus) {
    await notifyOrderStatus({ orderId, status: String(order.status) }).catch((error) =>
      console.error("Failed to notify about a cancelled consignment:", error),
    );
  }

  await auditOrderCancelled(params.auditContext, order, {
    from: currentStatus,
    by: "admin",
    consignmentOf: seller,
    reason: `${params.reason}${params.override ? " (override)" : ""}`,
  });
  if (order.status !== previousOrderStatus) {
    await auditOrderStatus(params.auditContext, order, {
      from: previousOrderStatus,
      to: String(order.status),
      reason: `${seller}'s consignment cancelled`,
    });
  }

  // The shopper gets this consignment's share back. Reported, never thrown:
  // the cancellation stands either way, and the admin is told what happened.
  const refund = await refundOrderCancellation({
    orderId,
    cancelledSubOrderIds: [subOrder._id],
    reason: `${seller}'s items cancelled by the store — ${params.reason}`,
    actor: params.actorLabel || params.actorUserId,
    createdBy: params.actorUserId,
    auditContext: params.auditContext,
  }).catch((error: unknown) => {
    console.error("Failed to refund a cancelled consignment:", error);
    return { refunded: false, reason: "The refund could not be issued" };
  });

  return { orderStatus: String(order.status), ...(refund ? { refund } : {}) };
}
