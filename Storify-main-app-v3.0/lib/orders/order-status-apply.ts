import { ORDER_STATUS } from "@/config/app.config";
import {
  DISPATCHED_ORDER_STATUSES,
  getOrderStatusTimestampUpdates,
  ORDER_STATUS_RANK,
  type OrderStatusValue,
} from "@/lib/orders/order-status-workflow";

/**
 * What a status transition writes to an order.
 *
 * This used to live inline in `PUT /api/admin/orders/[id]`, where it was
 * interleaved with refunds, permissions and coupon reversal. Anything else
 * that moves an order — the vendor route, and now carrier tracking arriving by
 * webhook — had to re-derive the same rules, and every re-derivation is a
 * chance to forget one: the sub-order cascade, the `shippedAt` stamp, or the
 * fact that the order-level `carrier` is only a summary of the most recent
 * shipment.
 *
 * Deliberately pure: it returns a `$set` document and nothing else, so it is
 * testable without a database and callers stay free to merge it with their own
 * updates (the admin route folds refund fields into the same write).
 */

const SUB_ORDER_PATH_MARKER = "$[so]";

/**
 * The `$set` key addressing a field on every sub-order the filter admits.
 *
 * Exported so a caller adding its own sub-order field — the admin route
 * stamping payment, say — spells the positional marker the same way this
 * module reads it back in `subOrderUpdateOptions`. A hand-written `$[so]`
 * that drifted would silently lose its arrayFilters.
 */
export function subOrderPath(field: string): string {
  return `subOrders.${SUB_ORDER_PATH_MARKER}.${field}`;
}

/**
 * The sub-order statuses a parent transition to `target` must leave alone.
 *
 * A cancelled consignment was always excluded. That was not enough: the filter
 * matched everything else, so cancelling a split order overwrote the sub-order
 * of a vendor who had already delivered — the customer's dashboard lost the
 * record of goods they were holding, and the cancellation handed that vendor's
 * stock back as if it had never left. The rule is now the obvious one:
 *
 *  - **a cancellation never touches goods that have shipped.** They are with
 *    the courier or with the customer; the paperwork does not get to say
 *    otherwise, and a return is what brings them back;
 *  - **no transition moves a consignment backwards.** Anything already at or
 *    beyond the target keeps its own status and timestamps, so marking a split
 *    order shipped cannot regress a sibling that is already delivered.
 *
 * With no target — a tracking-number write — only the cancelled exclusion
 * applies, which is all it ever needed.
 */
export function protectedSubOrderStatuses(target?: string): string[] {
  const protectedStatuses = new Set<string>([ORDER_STATUS.CANCELLED]);

  if (target === ORDER_STATUS.CANCELLED) {
    for (const status of DISPATCHED_ORDER_STATUSES) {
      protectedStatuses.add(status);
    }
    return [...protectedStatuses];
  }

  const targetRank = target ? ORDER_STATUS_RANK[target] : undefined;
  if (targetRank !== undefined) {
    for (const [status, rank] of Object.entries(ORDER_STATUS_RANK)) {
      if (rank >= targetRank) protectedStatuses.add(status);
    }
  }

  return [...protectedStatuses];
}

/** Matches sub-orders the parent transition to `target` is allowed to touch. */
function subOrderCascadeFilter(target?: string) {
  return { "so.status": { $nin: protectedSubOrderStatuses(target) } };
}

/**
 * The cascade an admin override uses instead.
 *
 * The protections above exist to stop the workflow contradicting physical
 * reality by accident. An override is someone stating that reality is not what
 * the record says, so those protections are exactly what has to give — a
 * rollback from `delivered` that left every consignment delivered would have
 * corrected nothing.
 *
 * `resurrecting` is the one distinction worth keeping. Bringing a cancelled
 * order back has to reach its cancelled consignments, or the order comes back
 * empty. Any other override must NOT: a merchant fixing a delivery date on a
 * three-seller order is not asking to un-cancel the seller who dropped out,
 * and silently reinstating them would be a second, bigger mistake made while
 * fixing the first.
 *
 * The filter names a field even when it means "everything" — Mongo rejects an
 * empty `arrayFilters` document.
 */
export function subOrderOverrideFilter(resurrecting: boolean) {
  return resurrecting
    ? { "so.status": { $exists: true } }
    : { "so.status": { $ne: ORDER_STATUS.CANCELLED } };
}

/**
 * The order status its sub-orders imply.
 *
 * An order is a wrapper around consignments, so it is only as far along as its
 * least advanced live one: three vendors, one still packing, is not a shipped
 * order. Cancelled sub-orders drop out of the reckoning entirely — an order
 * whose remaining vendor delivered IS delivered, and only when every last
 * consignment is cancelled is the order itself cancelled.
 *
 * Returns null when there is nothing to derive from, so callers can tell "no
 * sub-orders" apart from "sub-orders that agree on pending".
 */
export function deriveOrderStatusFromSubOrders(
  subOrders: Array<{ status?: string }> | undefined | null,
): OrderStatusValue | null {
  const all = subOrders || [];
  if (all.length === 0) return null;

  const live = all.filter((sub) => sub.status !== ORDER_STATUS.CANCELLED);
  if (live.length === 0) return ORDER_STATUS.CANCELLED;

  let least: string | null = null;
  for (const sub of live) {
    const status = String(sub.status || "");
    if (ORDER_STATUS_RANK[status] === undefined) continue;
    if (least === null || ORDER_STATUS_RANK[status] < ORDER_STATUS_RANK[least]) {
      least = status;
    }
  }

  return (least as OrderStatusValue) ?? null;
}

/**
 * The order status a consignment change should leave behind, or null to keep
 * the current one.
 *
 * The derivation above, with one refusal: it never walks a live order
 * BACKWARDS. A paid order is written `processing` at capture, and every order
 * captured before its consignments were moved along with it still carries
 * `pending` ones — so a vendor adding nothing but a tracking number re-derived
 * the order back to `pending`, where the shopper could cancel it outright,
 * sibling vendor's parcel included. Consignments only ever move forward, so a
 * lower answer than the order already holds is the stale record talking, not
 * news. Cancellation is not a rank and always goes through.
 */
export function rollUpOrderStatus(
  currentStatus: string | null | undefined,
  subOrders: Array<{ status?: string }> | undefined | null,
): OrderStatusValue | null {
  const derived = deriveOrderStatusFromSubOrders(subOrders);
  if (!derived || derived === currentStatus) return null;
  if (derived !== ORDER_STATUS.CANCELLED) {
    const currentRank = ORDER_STATUS_RANK[String(currentStatus || "")];
    const derivedRank = ORDER_STATUS_RANK[derived];
    if (
      currentRank !== undefined &&
      derivedRank !== undefined &&
      derivedRank < currentRank
    ) {
      return null;
    }
  }
  return derived;
}

/** True when a `$set` document addresses sub-orders positionally. */
export function usesSubOrderArrayFilter(
  updates: Record<string, unknown>,
): boolean {
  return Object.keys(updates).some((key) => key.includes(SUB_ORDER_PATH_MARKER));
}

/**
 * The order-level half of a `$set` document, with the sub-order paths dropped.
 *
 * The positional filter here matches every non-cancelled sub-order, which is
 * right for a status cascade and wrong for a tracking number: one parcel's AWB
 * mirrored onto a sibling would name the wrong courier for the wrong vendor.
 * A caller that has already written the correct sub-order takes this instead.
 */
export function orderLevelUpdatesOnly(
  updates: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(updates).filter(
      ([key]) => !key.includes(SUB_ORDER_PATH_MARKER),
    ),
  );
}

interface OrderStatusUpdateInput {
  /** The status being moved to. Omit to write only tracking/carrier. */
  status?: OrderStatusValue;
  changedAt?: Date;
  /** User id, or a system marker for automated transitions. */
  changedBy?: string;
  trackingNumber?: string;
  carrier?: string;
}

/**
 * Build the `$set` document for a status change.
 *
 * Callers are responsible for having validated the transition first — this
 * function describes a move it is already legal to make, and validating here
 * too would hide the difference between "refused" and "nothing to do" from the
 * routes that must report it.
 */
export function buildOrderStatusUpdates(
  input: OrderStatusUpdateInput,
): Record<string, unknown> {
  const changedAt = input.changedAt ?? new Date();
  const updates: Record<string, unknown> = {};

  const trackingNumber = input.trackingNumber?.trim();
  const carrier = input.carrier?.trim();

  if (input.status) {
    updates.status = input.status;
    Object.assign(updates, getOrderStatusTimestampUpdates(input.status, changedAt));
    if (input.changedBy) updates.statusChangedBy = input.changedBy;

    // A cancelled sub-order keeps its own status, tracking and timestamps —
    // hence the filtered positional operator rather than a blanket write.
    updates[subOrderPath("status")] = input.status;

    if (input.status === ORDER_STATUS.SHIPPED) {
      updates[subOrderPath("shippedAt")] = changedAt;
    }
    if (input.status === ORDER_STATUS.DELIVERED) {
      updates[subOrderPath("deliveredAt")] = changedAt;
    }
  }

  if (trackingNumber) {
    updates.trackingNumber = trackingNumber;
    updates[subOrderPath("trackingNumber")] = trackingNumber;
  }

  if (carrier) {
    // The order-level field can only name one courier, so on a split order it
    // is a "most recent shipment" summary; the sub-order carries the truth.
    updates.carrier = carrier;
    updates[subOrderPath("carrier")] = carrier;
  }

  return updates;
}

/** Which timestamp each status stamps, order-level and on the consignment. */
const STATUS_TIMESTAMPS: Array<{
  status: string;
  order: string;
  subOrder?: string;
}> = [
  { status: ORDER_STATUS.PROCESSING, order: "processingAt" },
  { status: ORDER_STATUS.SHIPPED, order: "shippedAt", subOrder: "shippedAt" },
  { status: ORDER_STATUS.DELIVERED, order: "deliveredAt", subOrder: "deliveredAt" },
];

/**
 * The `$unset` document a rollback needs.
 *
 * A status that moved backwards leaves timestamps from a future that no longer
 * happened, and they are not decoration: `deliveredAt` is what
 * `POST /api/returns` measures the return window from, so an order rolled back
 * out of `delivered` while keeping the stamp would keep counting down a window
 * for a delivery it no longer claims. The cancellation trace goes the same way
 * — an order that is live again was not cancelled.
 *
 * Only ever used by the override path. An ordinary transition moves forward
 * and has nothing behind it to clear.
 */
export function buildRollbackUnsets(target: OrderStatusValue): Record<string, "">
{
  const unsets: Record<string, ""> = {};
  const targetRank = ORDER_STATUS_RANK[target];

  if (targetRank !== undefined) {
    for (const entry of STATUS_TIMESTAMPS) {
      if ((ORDER_STATUS_RANK[entry.status] ?? 0) <= targetRank) continue;
      unsets[entry.order] = "";
      if (entry.subOrder) unsets[subOrderPath(entry.subOrder)] = "";
    }
  }

  if (target !== ORDER_STATUS.CANCELLED) {
    unsets.cancelledAt = "";
    unsets.cancelReason = "";
  }

  return unsets;
}

/**
 * Merge the options a sub-order-addressing `$set` needs into a Mongoose
 * update. A write with no positional path must not carry `arrayFilters` at
 * all — Mongo rejects unused filters.
 *
 * The target status is read back out of the `$set` document rather than taken
 * as an argument: it is already in there, and a second parameter would be one
 * more thing four call sites could pass inconsistently with the update they
 * are passing beside it.
 */
export function subOrderUpdateOptions(updates: Record<string, unknown>) {
  if (!usesSubOrderArrayFilter(updates)) return {};
  const target = updates[subOrderPath("status")];
  return {
    arrayFilters: [
      subOrderCascadeFilter(
        typeof target === "string" ? target : undefined,
      ),
    ],
  };
}
