import { ValidationError } from "@/lib/api/errors";
import {
  cycleMismatch,
  isActiveCollection,
  type CollectionCycleShape,
  type ScopeSubOrder,
} from "@/lib/orders/preorder-scope";

type RequestOrder = {
  preorderReadinessRevision?: number | null;
  preorderCollection?: CollectionCycleShape | null;
  subOrders?: ScopeSubOrder[] | null;
};

/**
 * Refuse to take a voluntary payment against a balance request that no longer
 * describes the order — a consignment cancelled, the amount changed — until
 * the new request is ready. A payment made before any request is fine: it is
 * recorded, and releases nothing until the goods are ready.
 */
export function assertBalanceRequestCurrent(
  order: RequestOrder,
  balanceDue: number,
  currency: string,
): void {
  const cycle = order.preorderCollection;
  if (!isActiveCollection(cycle)) return;
  if (cycleMismatch(order, cycle, balanceDue, currency)) {
    throw new ValidationError(
      "Your pre-order balance is being updated. Please try again in a few minutes.",
    );
  }
}
