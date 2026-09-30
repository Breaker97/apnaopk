import { Order } from "@/models";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { ORDER_STATUS } from "@/config/app.config";
import type { AuditContext } from "@/lib/audit";
import { restoreOrderInventory } from "@/lib/orders/order-inventory";
import { releaseOrderPreorders } from "@/lib/orders/preorders";
import {
  refundOrderCancellation,
  reportFailedCancelRefund,
} from "@/lib/orders/preorder-cancel-refund";
import { reverseCouponUsageForOrder } from "@/lib/catalog/coupons";
import { auditOrderCancelled } from "@/lib/orders/audit-order";
import {
  buildOrderStatusUpdates,
  subOrderUpdateOptions,
} from "@/lib/orders/order-status-apply";
import { reconcileOrderStatus } from "@/lib/orders/order-status-reconcile";
import { getPendingPaymentLock } from "@/lib/orders/pending-payment-lock";

/**
 * A shopper cancelling their own order.
 *
 * Lifted out of `PUT /api/orders/[id]` so that a guest cancelling a pre-order
 * from the link in their delay notice runs EXACTLY the cascade a signed-in
 * shopper does — status, stock, quota, coupon, audit and the refund — rather
 * than a second copy of a path that moves money, which is the kind that
 * quietly drifts (`preorder-cancel-refund.ts` already carries a note about
 * three such copies of the refund flow).
 *
 * The caller proves who is asking and hands over an order filter scoped to
 * that proof: `{ _id, customerId }` for a signed-in shopper, `{ _id,
 * hasPreorder: true }` for a verified manage-link holder, whose link is a
 * pre-order capability and nothing wider.
 */

export async function cancelOrderForCustomer(params: {
  orderFilter: Record<string, unknown>;
  auditContext: AuditContext;
  /** Recorded on the refund row. */
  createdBy?: string;
  /** Why, as the audit trail and refund row should say it. */
  reason?: string;
  /**
   * Who is cancelling. `system` is the address-hold deadline, which runs the
   * same cascade on an order nobody corrected — see `address-hold.ts`.
   */
  by?: "customer" | "system";
  /**
   * The statuses this cancellation may start from. A customer may only call
   * off an order that has not moved on; the address-hold deadline also reaches
   * one in `processing`, which is where a refused label leaves it.
   */
  allowedStatuses?: string[];
}) {
  const by = params.by ?? "customer";
  // Selects `status` rather than using `exists`, so the audit entry below can
  // name the status the order was cancelled FROM — and the consignments', so
  // the refund can tell which of them this cancellation actually called off.
  const existing = await Order.findOne(params.orderFilter)
    .select(
      "status paymentMethod paymentStatus channel subOrders._id subOrders.status",
    )
    .lean<{
      status?: string;
      paymentMethod?: string;
      paymentStatus?: string;
      channel?: string;
      subOrders?: Array<{ _id?: unknown; status?: string }>;
    }>();
  if (!existing) return null;

  // A mobile-money payment still in flight is not cancellable by anyone: the
  // PIN prompt may be answered a minute from now, and the money would land on
  // a cancelled order that these providers cannot refund automatically. The
  // shopper is told to wait rather than given a cancellation that could cost
  // them their money. See `lib/orders/pending-payment-lock.ts`.
  const pendingPaymentLock = getPendingPaymentLock(existing);
  if (pendingPaymentLock) throw new ValidationError(pendingPaymentLock);

  // Built from the shared cascade so a customer cancelling writes exactly
  // what an admin cancelling writes. It previously used a bare `$[]`,
  // which addresses EVERY sub-order unconditionally — on a split order
  // where one vendor had already handed the goods over, that erased the
  // delivery and, until the same change fixed it, restocked the units.
  const updates = {
    ...buildOrderStatusUpdates({ status: ORDER_STATUS.CANCELLED }),
    cancelReason:
      by === "system" ? params.reason || "Cancelled automatically" : "Cancelled by customer",
  };

  // Atomic status guard: the cancellable status is part of the filter, so a
  // concurrent admin transition (e.g. pending -> shipped) makes this write
  // match nothing instead of regressing a shipped order to cancelled.
  const order = await Order.findOneAndUpdate(
    {
      ...params.orderFilter,
      status: {
        $in: params.allowedStatuses ?? [ORDER_STATUS.PENDING, ORDER_STATUS.PREORDERED],
      },
    },
    { $set: updates },
    { returnDocument: "after", ...subOrderUpdateOptions(updates) },
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
  // And any label already bought for goods that are now staying put.
  const { voidLabelsForCancellation } = await import("@/lib/shipping/cancel-labels");
  await voidLabelsForCancellation({ orderId: order._id }).catch((err) =>
    console.error("Failed to void labels on customer cancel:", err),
  );

  // Only when the whole order actually went. If a co-vendor's parcel
  // survived the cancellation, the customer is still receiving goods they
  // bought with that discount — same rule as the admin route.
  if (order.status === ORDER_STATUS.CANCELLED) {
    await reverseCouponUsageForOrder(String(order._id)).catch((err) =>
      console.error("Failed to reverse coupon usage on customer cancel:", err),
    );
  }

  // A customer cancelling their own order restocked inventory, released
  // preorder quota and reversed a coupon — and left no trace on the order.
  await auditOrderCancelled(params.auditContext, order, {
    from: String(existing.status),
    by,
    reason: params.reason,
  });

  // Cancel means refund, whenever money was taken. It used to refund only a
  // pre-order, so a card order the shopper could still cancel — one whose
  // consignments had not moved on — was cancelled and restocked with the money
  // kept. A split order whose sibling survived gives back only what this
  // cancellation called off; nothing collected means nothing to report.
  //
  // Reported rather than thrown: the cancellation has already committed
  // and is not being undone, so a gateway refusal has to reach the shopper
  // as "we owe you this" instead of a failed request that hides it.
  const wasCancelled = new Set(
    (existing.subOrders || [])
      .filter((sub) => sub.status === ORDER_STATUS.CANCELLED)
      .map((sub) => String(sub._id)),
  );
  const cancelledNow = (
    (order.subOrders || []) as Array<{ _id?: unknown; status?: string }>
  )
    .filter(
      (sub) =>
        sub.status === ORDER_STATUS.CANCELLED && !wasCancelled.has(String(sub._id)),
    )
    .map((sub) => sub._id);
  const refund = await refundOrderCancellation({
    orderId: String(order._id),
    cancelledSubOrderIds: cancelledNow,
    reason:
      params.reason ||
      (order.hasPreorder
        ? "Pre-order cancelled by the customer"
        : "Order cancelled by the customer"),
    createdBy: params.createdBy,
    auditContext: params.auditContext,
  }).catch(async (err: unknown) => {
    console.error("Failed to refund customer-cancelled order:", err);
    // No admin was involved in this cancel, so nobody else would ever know.
    await reportFailedCancelRefund({
      order,
      why: err instanceof Error ? err.message : "the refund could not be issued",
    });
    // `failed` tells this apart from an order that simply took no money, so a
    // shopper is only ever told money is owed when it is.
    return {
      refunded: false,
      failed: true,
      reason: "The refund could not be issued",
    };
  });

  return { order, ...(refund ? { refund } : {}) };
}
