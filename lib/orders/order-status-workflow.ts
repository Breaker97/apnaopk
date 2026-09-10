import { ORDER_STATUS } from "@/config/app.config";

export type OrderStatusValue =
  (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

type OrderStatusActionId =
  | "mark_ready_to_fulfill"
  | "mark_processing"
  | "mark_shipped"
  | "mark_delivered"
  | "cancel_order";

/**
 * A permitted transition out of the current status.
 *
 * Deliberately carries no display copy: this module is imported by the API
 * routes that validate transitions, so any label here would be an English
 * string rendered into a localized UI. Menus translate by id instead
 * (`admin.orderDetails.statusAction.<id>`).
 */
export interface OrderStatusActionDefinition {
  id: OrderStatusActionId;
  to: OrderStatusValue;
  destructive?: boolean;
}

const ORDER_STATUS_ACTIONS: Record<
  OrderStatusActionId,
  OrderStatusActionDefinition
> = {
  // Releases a preorder into normal fulfillment.
  mark_ready_to_fulfill: {
    id: "mark_ready_to_fulfill",
    to: ORDER_STATUS.PROCESSING,
  },
  mark_processing: {
    id: "mark_processing",
    to: ORDER_STATUS.PROCESSING,
  },
  mark_shipped: {
    id: "mark_shipped",
    to: ORDER_STATUS.SHIPPED,
  },
  mark_delivered: {
    id: "mark_delivered",
    to: ORDER_STATUS.DELIVERED,
  },
  // Cancels the order and restores inventory when possible.
  cancel_order: {
    id: "cancel_order",
    to: ORDER_STATUS.CANCELLED,
    destructive: true,
  },
};

const ORDER_STATUS_WORKFLOW: Record<
  OrderStatusValue,
  OrderStatusActionId[]
> = {
  [ORDER_STATUS.PREORDERED]: ["mark_ready_to_fulfill", "cancel_order"],
  [ORDER_STATUS.PENDING]: ["mark_processing", "cancel_order"],
  [ORDER_STATUS.PROCESSING]: ["mark_shipped", "cancel_order"],
  [ORDER_STATUS.SHIPPED]: ["mark_delivered"],
  [ORDER_STATUS.DELIVERED]: [],
  [ORDER_STATUS.CANCELLED]: [],
};

/**
 * How far along a status is, for the questions the workflow graph cannot
 * answer: "has this consignment already overtaken the one I am about to write?"
 *
 * `cancelled` is deliberately absent. It is not a further stage of the same
 * journey but a different ending, so giving it a number would let a comparison
 * conclude that a cancelled parcel is more or less delivered than a shipped
 * one. Callers test for it by name.
 */
export const ORDER_STATUS_RANK: Record<string, number> = {
  [ORDER_STATUS.PREORDERED]: 0,
  [ORDER_STATUS.PENDING]: 1,
  [ORDER_STATUS.PROCESSING]: 2,
  [ORDER_STATUS.SHIPPED]: 3,
  [ORDER_STATUS.DELIVERED]: 4,
};

/**
 * Statuses whose goods have physically left the seller.
 *
 * The line that matters for both of this module's dangerous operations: these
 * are the consignments a parent cancellation must not overwrite, and the ones
 * whose stock must not be handed back on the strength of that cancellation.
 */
export const DISPATCHED_ORDER_STATUSES: string[] = [
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.DELIVERED,
];

export function getOrderStatusActions(
  status: string,
): OrderStatusActionDefinition[] {
  const actionIds =
    ORDER_STATUS_WORKFLOW[status as OrderStatusValue] ??
    ORDER_STATUS_WORKFLOW[ORDER_STATUS.PENDING];
  return actionIds.map((id) => ORDER_STATUS_ACTIONS[id]);
}

export function getOrderStatusActionByTarget(
  currentStatus: string,
  nextStatus: string,
): OrderStatusActionDefinition | null {
  return (
    getOrderStatusActions(currentStatus).find(
      (action) => action.to === nextStatus,
    ) ?? null
  );
}

export function canTransitionOrderStatus(
  currentStatus: string,
  nextStatus: string,
): boolean {
  return Boolean(getOrderStatusActionByTarget(currentStatus, nextStatus));
}

/**
 * The shortest legal route from one status to another, as the ordered list of
 * transitions to apply.
 *
 * A courier telling us a parcel is in transit does not care that the order was
 * still `pending` — a COD order, say, that nobody moved to `processing` by
 * hand. The naive fix is to write `shipped` directly, which puts the order in
 * a state no button could have produced and skips the `processingAt` stamp.
 * Walking the graph instead means an automated caller applies only edges a
 * human could also have applied, and the workflow above stays the one place
 * that says what is legal.
 *
 * Returns `[]` when already at the target and `null` when it is unreachable
 * (a shipped order can never become cancelled) — the caller must tell those
 * apart, so "nothing to do" is never conflated with "refused".
 */
export function advanceOrderStatusTo(
  currentStatus: string,
  targetStatus: string,
): OrderStatusActionDefinition[] | null {
  if (currentStatus === targetStatus) return [];

  // Breadth-first over a graph of six nodes: cheap, and it stays correct if a
  // future status makes the workflow non-linear.
  const queue: Array<{
    status: string;
    path: OrderStatusActionDefinition[];
  }> = [{ status: currentStatus, path: [] }];
  const seen = new Set<string>([currentStatus]);

  while (queue.length > 0) {
    const { status, path } = queue.shift()!;
    for (const action of getOrderStatusActions(status)) {
      if (seen.has(action.to)) continue;
      const nextPath = [...path, action];
      if (action.to === targetStatus) return nextPath;
      // A destructive edge is only ever a destination, never a corridor:
      // routing "get this to delivered" through a cancellation would be
      // catastrophic, so it is not a shortcut the search may take.
      if (action.destructive) continue;
      seen.add(action.to);
      queue.push({ status: action.to, path: nextPath });
    }
  }

  return null;
}

export function getOrderStatusTimestampUpdates(
  nextStatus: string,
  changedAt = new Date(),
): Record<string, Date> {
  if (nextStatus === ORDER_STATUS.PROCESSING) {
    return { processingAt: changedAt };
  }
  if (nextStatus === ORDER_STATUS.SHIPPED) {
    return { shippedAt: changedAt };
  }
  if (nextStatus === ORDER_STATUS.DELIVERED) {
    return { deliveredAt: changedAt };
  }
  if (nextStatus === ORDER_STATUS.CANCELLED) {
    return { cancelledAt: changedAt };
  }
  return {};
}

export function shouldRestoreInventoryForStatusTransition(
  currentStatus: string,
  nextStatus: string,
) {
  return (
    nextStatus === ORDER_STATUS.CANCELLED &&
    currentStatus !== ORDER_STATUS.CANCELLED
  );
}
