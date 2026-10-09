import {
  ConflictError,
  ServiceUnavailableError,
  ValidationError,
} from "@/lib/api/errors";
import type { PreparationOutcome } from "@/lib/orders/preorder-collection";
import type { StockBlocker } from "@/lib/orders/preorder-allocation";

/**
 * What the pre-order action routes answer, in one place — the admin single
 * and bulk routes and the vendor route all describe the same outcomes in the
 * same words. A vendor is never told about another seller's stock or money.
 */

const REASON_MESSAGES: Record<string, string> = {
  order_missing: "Pre-order not found",
  order_cancelled: "This pre-order has been cancelled and can no longer be updated",
  already_cancelled: "This pre-order has already been cancelled",
  nothing_waiting: "Nothing on this pre-order is still waiting to be released",
  nothing_to_cancel: "Nothing on this pre-order is left to cancel",
  consignment_not_waiting: "This consignment has already been released",
  consignment_dispatched: "This consignment has already shipped, so it is past the pre-order stage",
  dispatched:
    "Part of this order has already shipped, so it can no longer be cancelled here — handle it as a return",
  consignment_cancelled: "This consignment has been cancelled",
  unknown_consignment: "This consignment is not part of the order",
  no_preorder_lines: "This consignment has no pre-order items",
  balance_due: "The customer has not paid the rest of this pre-order yet",
  date_sync_pending:
    "A release date change is still being applied to this order — try again in a few minutes",
  charge_outcome_unknown:
    "A card payment for this balance is still being confirmed — try again in a few minutes",
  mixed_consignment:
    "This consignment's stock was already taken at checkout together with its pre-order items, so it needs checking by hand before it can be allocated",
  legacy_inventory_flag:
    "This consignment's stock was taken by an older version without a record of what, so it needs checking by hand before it can be released",
  missing_reservation_flag:
    "This consignment's reservation record is missing, so its stock needs checking by hand before it can be allocated",
  collection_prepared:
    "The balance has already been requested for these goods — change the release date instead to take it back",
};

export function describePreorderReason(reason: string): string {
  return REASON_MESSAGES[reason] || reason;
}

export function blockersMessage(blockers: StockBlocker[]): string {
  const units = blockers.reduce((sum, blocker) => sum + blocker.requested, 0);
  return `Not enough stock is recorded to allocate this pre-order (${units} unit${
    units === 1 ? "" : "s"
  } needed). Record the received units first.`;
}

/**
 * Throw the API error a failed preparation means. A vendor sees only blockers
 * on their own consignments; another seller's shortage reads as "waiting".
 */
export function throwForPreparation(
  outcome: PreparationOutcome,
  scope: { vendorSubOrderIds?: string[] } = {},
): void {
  switch (outcome.kind) {
    case "waiting_for_stock": {
      const own = scope.vendorSubOrderIds
        ? outcome.blockers.filter((blocker) =>
            scope.vendorSubOrderIds!.includes(blocker.subOrderId),
          )
        : outcome.blockers;
      if (scope.vendorSubOrderIds && own.length === 0) {
        throw new ConflictError(
          "Your goods are marked available. The balance will be requested once the other consignments on this order have their stock recorded.",
          { outcome: "waiting_for_stock" },
        );
      }
      throw new ConflictError(blockersMessage(own), {
        outcome: "waiting_for_stock",
        blockers: scope.vendorSubOrderIds
          ? own.map(({ productId, variantId, requested, available }) => ({
              productId,
              variantId,
              requested,
              available,
            }))
          : own,
      });
    }
    case "in_progress":
      throw new ConflictError(
        "Another change to this pre-order is in progress — try again in a moment.",
        { outcome: "in_progress", retryAfterSeconds: outcome.retryAfterSeconds },
      );
    case "conflict":
    case "reconciliation_required":
      throw new ConflictError(describePreorderReason(outcome.reason), {
        outcome: outcome.kind,
        reason: outcome.reason,
      });
    case "unavailable":
      throw new ServiceUnavailableError(
        "Pre-order stock cannot be allocated on this database setup (it needs MongoDB transactions). Nothing was changed.",
      );
    case "not_eligible":
      throw new ValidationError(describePreorderReason(outcome.reason));
    default:
      return;
  }
}

/** The success message a completed preparation reads as. */
export function preparationMessage(
  outcome: PreparationOutcome,
  audience: "admin" | "vendor",
): string | undefined {
  switch (outcome.kind) {
    case "waiting_for_vendors":
      return audience === "vendor"
        ? `Your goods are marked available. Waiting for ${outcome.waitingCount} other consignment${outcome.waitingCount === 1 ? "" : "s"} on this order before the balance is requested.`
        : `Marked available. Waiting for ${outcome.waitingCount} consignment${outcome.waitingCount === 1 ? "" : "s"} still to be marked available.`;
    case "notice_pending":
      return "The balance has been requested. The customer is being sent the advance notice; they can pay straight away.";
    case "balance_requested":
      return "The balance has already been requested for these goods.";
    case "released":
      return "Released for fulfilment.";
    default:
      return undefined;
  }
}
