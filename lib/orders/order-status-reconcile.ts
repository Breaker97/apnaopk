import "server-only";

import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import { deriveOrderStatusFromSubOrders } from "@/lib/orders/order-status-apply";
import type { OrderStatusValue } from "@/lib/orders/order-status-workflow";

/**
 * Put the order-level status back in step with its consignments.
 *
 * A parent transition writes the order and its sub-orders in one `$set`, but
 * the cascade deliberately refuses to touch consignments that have already
 * shipped or overtaken the target (`protectedSubOrderStatuses`). So the two
 * halves of that write can legitimately disagree: cancelling a split order in
 * which one vendor has delivered cancels the vendor who had not, and the order
 * is then not a cancelled order — it is a delivered one with a cancelled part.
 *
 * Left alone, that disagreement is exactly the bug this whole change is about,
 * only inverted: the order-level badge would claim a cancellation the goods
 * never had. So the status is re-derived from what the write actually left
 * behind, and corrected in a second small update.
 *
 * Timestamps come from the sub-orders rather than the clock. Reconciliation
 * happens some time after the event it is describing, and `deliveredAt` means
 * when the goods arrived, not when the paperwork caught up.
 */

type SubOrderTimestamps = {
  status?: string;
  shippedAt?: Date | string | null;
  deliveredAt?: Date | string | null;
};

function latestTimestamp(
  subOrders: SubOrderTimestamps[],
  field: "shippedAt" | "deliveredAt",
): Date | undefined {
  let latest: Date | undefined;
  for (const subOrder of subOrders) {
    if (subOrder.status === ORDER_STATUS.CANCELLED) continue;
    const value = subOrder[field];
    if (!value) continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

interface ReconcilableOrder {
  _id: unknown;
  status?: string;
  subOrders?: SubOrderTimestamps[] | null;
}

/**
 * Returns the corrected status when one was written, or null when the order
 * already agreed with its sub-orders (the common case, and a no-op).
 */
export async function reconcileOrderStatus(
  order: ReconcilableOrder,
): Promise<OrderStatusValue | null> {
  const subOrders = order.subOrders || [];
  // Single-consignment orders cannot disagree with themselves, and skipping
  // them keeps this off the hot path of every ordinary store.
  if (subOrders.length < 2) return null;

  const derived = deriveOrderStatusFromSubOrders(subOrders);
  if (!derived || derived === order.status) return null;

  const updates: Record<string, unknown> = { status: derived };
  if (derived === ORDER_STATUS.DELIVERED) {
    const deliveredAt = latestTimestamp(subOrders, "deliveredAt");
    if (deliveredAt) updates.deliveredAt = deliveredAt;
  }
  if (derived === ORDER_STATUS.SHIPPED) {
    const shippedAt = latestTimestamp(subOrders, "shippedAt");
    if (shippedAt) updates.shippedAt = shippedAt;
  }

  await Order.updateOne({ _id: order._id }, { $set: updates });
  return derived;
}
