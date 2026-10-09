import { Order } from "@/models";
import {
  AuthorizationError,
  ConflictError,
  ServiceUnavailableError,
  ValidationError,
} from "@/lib/api/errors";
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
import { CUSTOMER_CANCELLABLE_STATUSES } from "@/lib/orders/customer-cancel-policy";

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
      "_id status paymentMethod paymentStatus channel hasPreorder subOrders._id subOrders.status",
    )
    .lean<{
      _id: unknown;
      status?: string;
      paymentMethod?: string;
      paymentStatus?: string;
      channel?: string;
      hasPreorder?: boolean;
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

  // A pre-order is cancelled by the same transactional, resumable operation
  // the store, its sellers and the expiry use: status, allocated stock,
  // reservation places, the open balance request and a durable record of the
  // refund and the rest, together. Where the deployment cannot run that
  // transaction, the cascade below still applies (its restores read the
  // allocation evidence), as it always has.
  if (existing.hasPreorder) {
    const { getTransactionSupport } = await import("@/lib/db-transaction");
    if ((await getTransactionSupport()).supported) {
      return cancelPreorderForCustomer({ ...params, by, existing });
    }
  }

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
        $in: params.allowedStatuses ?? [...CUSTOMER_CANCELLABLE_STATUSES],
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

  // A pre-order's open balance request goes with what it covered; a part
  // that survived gets a request of its own.
  if (order.hasPreorder) {
    const { afterPreorderScopeChange } = await import("@/lib/orders/preorder-collection");
    await afterPreorderScopeChange(String(order._id)).catch((err) =>
      console.error("Failed to reconcile a pre-order after a customer cancel:", err),
    );
  }

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

/**
 * `cancelOrderForCustomer` for a pre-order: the shared cancellation, guarded
 * by the caller's proof (`orderFilter`) and the statuses it may start from —
 * both re-read inside the transaction.
 */
async function cancelPreorderForCustomer(params: {
  orderFilter: Record<string, unknown>;
  auditContext: AuditContext;
  createdBy?: string;
  reason?: string;
  by: "customer" | "system";
  allowedStatuses?: string[];
  existing: { _id: unknown; status?: string };
}) {
  const { cancelPreorder } = await import("@/lib/orders/preorder-cancellation");
  const allowed = params.allowedStatuses ?? [ORDER_STATUS.PENDING, ORDER_STATUS.PREORDERED];
  const system = params.by === "system";
  const reason =
    params.reason ||
    (system ? "Cancelled automatically" : "Pre-order cancelled by the customer");
  const outcome = await cancelPreorder({
    orderId: String(params.existing._id),
    actor: system ? "system" : params.createdBy || params.auditContext.userId || "customer",
    actorRole: system ? "system" : params.auditContext.userRole || "customer",
    actorEmail: params.auditContext.userEmail,
    source: system ? "system" : "customer",
    reason,
    scopeFilter: { ...params.orderFilter, status: { $in: allowed } },
    // The shopper asked (and is answered by the response), or the caller
    // sends its own message — as this cascade always behaved.
    notifyCustomer: false,
  });
  if (outcome.kind === "in_progress") {
    throw new ConflictError("This order is changing right now — try again in a moment.");
  }
  if (outcome.kind === "unavailable") {
    throw new ServiceUnavailableError(outcome.reason);
  }
  if (outcome.kind === "refused") {
    throw new AuthorizationError("You can only cancel pending orders");
  }
  const order = await Order.findById(params.existing._id);
  if (!order) return null;
  await auditOrderCancelled(params.auditContext, order, {
    from: String(params.existing.status),
    by: params.by,
    reason: params.reason,
  });
  const refund = outcome.refund;
  return {
    order,
    ...(refund
      ? {
          refund: {
            refunded: refund.refunded,
            ...(typeof refund.amount === "number" ? { amount: refund.amount } : {}),
            ...(refund.currency ? { currency: refund.currency } : {}),
            ...(refund.reason ? { reason: refund.reason } : {}),
            ...(refund.pending ? { pending: true } : {}),
          },
        }
      : {}),
  };
}
