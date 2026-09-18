import { ConflictError } from "@/lib/api/errors";

/**
 * Save an order only over the statuses it was read with.
 *
 * A route loads an order, decides what may happen from what it sees, and
 * saves. Two requests doing that at once both decide on the same read, and the
 * later save quietly writes back whatever the earlier one changed — a
 * consignment cancelled and refunded a moment ago becomes `processing` again,
 * and a label is queued for goods the shopper has their money back for.
 *
 * The save is conditional on the order's status and every consignment's status
 * still being what was read, so the loser of that race gets a conflict instead
 * of overwriting. Three routes carried a hand-written copy of this; the rest
 * carried nothing.
 */
export type OrderStatusSnapshot = {
  status?: string | null;
  subOrders?: Array<{ status?: string | null }> | null;
};

/** The `$where` a save is conditional on — see {@link saveOrderOverReadStatuses}. */
export function readStatusGuard(before: OrderStatusSnapshot): Record<string, unknown> {
  const guard: Record<string, unknown> = { status: before.status };
  (before.subOrders || []).forEach((sub, index) => {
    guard[`subOrders.${index}.status`] = sub?.status;
  });
  return guard;
}

export const ORDER_CHANGED_MESSAGE =
  "This order changed while you were updating it. Refresh the page and try again.";

export async function saveOrderOverReadStatuses(
  order: { save: () => Promise<unknown> },
  before: OrderStatusSnapshot,
): Promise<void> {
  (order as unknown as { $where?: Record<string, unknown> }).$where =
    readStatusGuard(before);
  try {
    await order.save();
  } catch (error) {
    if ((error as { name?: string })?.name === "DocumentNotFoundError") {
      throw new ConflictError(ORDER_CHANGED_MESSAGE);
    }
    throw error;
  }
}

/** The statuses of an order as read, taken before anything is changed in memory. */
export function snapshotOrderStatuses(order: {
  status?: string | null;
  subOrders?: Array<{ status?: string | null }> | null;
}): OrderStatusSnapshot {
  return {
    status: order.status,
    subOrders: (order.subOrders || []).map((sub) => ({ status: sub?.status })),
  };
}
