import "server-only";

import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import {
  advanceOrderStatusTo,
  ORDER_STATUS_RANK,
  type OrderStatusValue,
} from "@/lib/orders/order-status-workflow";
import {
  buildOrderStatusUpdates,
  orderLevelUpdatesOnly,
  subOrderUpdateOptions,
} from "@/lib/orders/order-status-apply";
import { notifyOrderStatus } from "@/lib/notifications/notifications";
import { createSystemAuditContext } from "@/lib/audit";
import { auditOrderShipment, auditOrderStatus } from "@/lib/orders/audit-order";
import type { IOrder, SubOrder } from "@/types";

/**
 * Carrier movement, applied to the order.
 *
 * Built on `buildOrderStatusUpdates` rather than writing its own `$set` so a
 * webhook-driven transition writes exactly what a merchant clicking the same
 * button writes — the sub-order cascade, the timestamps and the arrayFilters
 * all come from one place.
 */

interface TrackingCascadeResult {
  applied: boolean;
  /** Present when the transition was refused, for the audit trail. */
  reason?: "order_missing" | "sub_order_missing" | "unreachable" | "conflict";
  orderStatus?: OrderStatusValue;
}

/**
 * Record a parcel's tracking on its sub-order and, when every sibling has
 * caught up, on the order.
 */
export async function applyShipmentTrackingToOrder(params: {
  orderId: string;
  subOrderId?: string;
  trackingNumber?: string;
  carrier?: string;
  /**
   * Omit to record the tracking number and courier without moving the order.
   * Buying a label is not the same event as the parcel moving, and a merchant
   * who turned *Mark the order shipped* off is asking for exactly that split.
   */
  targetStatus?: OrderStatusValue;
}): Promise<TrackingCascadeResult> {
  const order = await Order.findById(params.orderId).lean<IOrder | null>();
  if (!order) return { applied: false, reason: "order_missing" };

  const subOrders = order.subOrders || [];
  const subOrder: SubOrder | undefined = params.subOrderId
    ? subOrders.find((entry) => String(entry._id) === params.subOrderId)
    : subOrders[0];
  if (!subOrder) return { applied: false, reason: "sub_order_missing" };

  // Step 1 — the sub-order this parcel actually belongs to.
  const subPath = params.subOrderId
    ? { "subOrders._id": subOrder._id }
    : { "subOrders.vendorId": subOrder.vendorId };

  const subUpdates: Record<string, unknown> = {};
  if (params.trackingNumber) {
    subUpdates["subOrders.$[so].trackingNumber"] = params.trackingNumber;
  }
  if (params.carrier) {
    subUpdates["subOrders.$[so].carrier"] = params.carrier;
  }

  // The workflow forbids pending → shipped, so a COD order nobody moved to
  // processing walks the legal path one edge at a time instead of jumping.
  const subPath2 = params.targetStatus
    ? advanceOrderStatusTo(subOrder.status, params.targetStatus)
    : [];
  if (subPath2 === null) {
    // Unreachable — e.g. a delivered parcel reporting movement, or a
    // cancellation. Tracking is still recorded; the status is not rewritten.
    if (Object.keys(subUpdates).length > 0) {
      await Order.updateOne(
        { _id: order._id, ...subPath },
        { $set: subUpdates },
        {
          arrayFilters: [{ "so._id": subOrder._id }],
        },
      ).catch(() => undefined);
    }
    return { applied: false, reason: "unreachable" };
  }

  const now = new Date();
  // Each step only over the status the previous one left. A carrier scan and
  // a cancellation landing together both started from the same read, and the
  // scan's unconditional write put a consignment that had just been cancelled
  // and refunded back to `shipped` — the order-level step below was guarded,
  // this one was not.
  let expectedStatus = subOrder.status;
  for (const step of subPath2) {
    const moved = await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          "subOrders.$[so].status": step.to,
          ...(step.to === ORDER_STATUS.SHIPPED
            ? { "subOrders.$[so].shippedAt": now }
            : {}),
          ...(step.to === ORDER_STATUS.DELIVERED
            ? { "subOrders.$[so].deliveredAt": now }
            : {}),
        },
      },
      { arrayFilters: [{ "so._id": subOrder._id, "so.status": expectedStatus }] },
    );
    if (moved.modifiedCount === 0) {
      return { applied: false, reason: "conflict" };
    }
    expectedStatus = step.to;
  }

  if (Object.keys(subUpdates).length > 0) {
    await Order.updateOne(
      { _id: order._id },
      { $set: subUpdates },
      {
        arrayFilters: [{ "so._id": subOrder._id }],
      },
    );
  }

  // Step 2 — the order, but only once every sibling has caught up. A split
  // order is not shipped because one vendor's parcel moved.
  const refreshed = await Order.findById(order._id).lean<IOrder | null>();
  if (!refreshed) return { applied: true, reason: "order_missing" };

  const live = (refreshed.subOrders || []).filter(
    (entry) => entry.status !== ORDER_STATUS.CANCELLED,
  );
  const targetRank = params.targetStatus
    ? (ORDER_STATUS_RANK[params.targetStatus] ?? 0)
    : 0;
  const allCaughtUp =
    live.length > 0 &&
    live.every((entry) => (ORDER_STATUS_RANK[entry.status] ?? 0) >= targetRank);

  if (!allCaughtUp) {
    // The status stays where it is — one vendor's parcel does not ship an order
    // — but the order-level carrier and AWB are a "most recent shipment"
    // summary, and they are what the public tracking page reads. Skipping them
    // here hid a dispatched parcel's tracking number from the customer until
    // every other seller had caught up.
    //
    // An order with no live consignment left gets nothing: there is no parcel
    // in flight for the summary to be about.
    if (live.length > 0) {
      await writeOrderTrackingSummary(order._id, params);
    }
    return { applied: true, orderStatus: refreshed.status as OrderStatusValue };
  }

  const orderPath = params.targetStatus
    ? advanceOrderStatusTo(refreshed.status, params.targetStatus)
    : [];
  if (orderPath === null || orderPath.length === 0) {
    // No status edge to walk, but the order-level fields are a summary of the
    // most recent shipment — so a label bought on an already-shipped order, or
    // one bought with the status move switched off, still names its courier.
    await writeOrderTrackingSummary(order._id, params);
    return { applied: true, orderStatus: refreshed.status as OrderStatusValue };
  }

  let currentStatus = refreshed.status as OrderStatusValue;
  for (const step of orderPath) {
    const updates = buildOrderStatusUpdates({
      status: step.to,
      changedAt: new Date(),
      changedBy: "system",
      trackingNumber: params.trackingNumber,
      carrier: params.carrier,
    });
    // Optimistic-concurrency guard: a merchant cancelling while a webhook lands
    // must win, not be silently overwritten.
    const result = await Order.updateOne(
      { _id: order._id, status: currentStatus },
      { $set: updates },
      subOrderUpdateOptions(updates),
    );
    if (result.matchedCount === 0) {
      return { applied: true, reason: "conflict", orderStatus: currentStatus };
    }
    currentStatus = step.to;
  }

  // `notifyOrderStatus` dedupes on {type, orderNumber, status, role}, so a
  // webhook racing a manual mark-shipped cannot notify the customer twice.
  await notifyOrderStatus({
    orderId: String(refreshed._id),
    status: currentStatus,
  }).catch(console.error);

  const auditContext = createSystemAuditContext();
  await auditOrderStatus(auditContext, refreshed, {
    from: refreshed.status,
    to: currentStatus,
    reason: "carrier tracking update",
  }).catch(console.error);
  if (params.trackingNumber) {
    await auditOrderShipment(auditContext, refreshed, {
      carrier: params.carrier || "",
      trackingNumber: params.trackingNumber,
    }).catch(console.error);
  }

  return { applied: true, orderStatus: currentStatus };
}

/**
 * Take a voided parcel's tracking number back off its order.
 *
 * Matched on the tracking number rather than blanket-cleared: on a split order
 * the order-level fields are a summary of the most recent shipment, which may
 * belong to a different vendor's parcel that is still perfectly live.
 *
 * The status is deliberately left where it is. Voiding a label is not evidence
 * the parcel came back — the merchant may be re-booking it with another courier
 * within the minute — and walking an order backwards from `shipped` is a
 * decision for whoever is looking at it, not for a refund call.
 */
export async function clearShipmentTrackingFromOrder(params: {
  orderId: string;
  /**
   * Passed through unstringified, like every other `arrayFilters` caller in
   * this file: a positional filter is matched against the stored ObjectId, and
   * casting it is not something to rely on.
   */
  subOrderId?: unknown;
  trackingNumber: string;
}): Promise<void> {
  const unset = { trackingNumber: "", carrier: "" };

  if (params.subOrderId) {
    await Order.updateOne(
      { _id: params.orderId },
      {
        $unset: {
          "subOrders.$[so].trackingNumber": "",
          "subOrders.$[so].carrier": "",
        },
      },
      {
        arrayFilters: [
          {
            "so._id": params.subOrderId,
            "so.trackingNumber": params.trackingNumber,
          },
        ],
      },
    );
  }

  await Order.updateOne(
    { _id: params.orderId, trackingNumber: params.trackingNumber },
    { $unset: unset },
  );
}

/**
 * Write the order-level tracking/carrier summary without touching status.
 *
 * Uses the same builder as a status transition so the two never disagree about
 * which fields a tracking number lands on.
 */
async function writeOrderTrackingSummary(
  orderId: unknown,
  params: { trackingNumber?: string; carrier?: string },
) {
  // The sub-order this parcel belongs to was already written above, addressed
  // by its own id — so only the order-level summary is left to set.
  const updates = orderLevelUpdatesOnly(
    buildOrderStatusUpdates({
      trackingNumber: params.trackingNumber,
      carrier: params.carrier,
    }),
  );
  if (Object.keys(updates).length === 0) return;

  await Order.updateOne({ _id: orderId }, { $set: updates });
}
