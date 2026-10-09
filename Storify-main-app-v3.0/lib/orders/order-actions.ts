import "server-only";

import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import type { StaffAccessScope } from "@/lib/access/staff-scope";
import {
  buildStaffOrderScopeFilter,
  isOrderEntirelyInScope,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import type { AuditContext } from "@/lib/audit";
import { afterResponse } from "@/lib/after-response";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { reverseCouponUsageForOrder } from "@/lib/catalog/coupons";
import { notifyOrderStatus } from "@/lib/notifications/notifications";
import {
  ADDRESS_HOLD_SHIPPING_BLOCK,
  isAddressHoldOpen,
} from "@/lib/orders/address-hold-policy";
import {
  auditOrderCancelled,
  auditOrderStatus,
  auditOrderStatusOverride,
} from "@/lib/orders/audit-order";
import {
  describeFulfillmentPaymentBlock,
  isFulfillmentTransition,
  type FulfillmentPaymentBlockKind,
} from "@/lib/orders/fulfillment-payment-gate";
import {
  restoreOrderInventory,
  restoreSubOrderInventory,
} from "@/lib/orders/order-inventory";
import {
  getPreorderCollectedAmount,
  type SubOrderPaymentShape,
} from "@/lib/orders/order-payment-status";
import {
  buildOrderStatusUpdates,
  rollUpOrderStatus,
  subOrderUpdateOptions,
} from "@/lib/orders/order-status-apply";
import { reconcileOrderStatus } from "@/lib/orders/order-status-reconcile";
import {
  DISPATCHED_ORDER_STATUSES,
  getOrderStatusActionByTarget,
  getOrderStatusTimestampUpdates,
  shouldRestoreInventoryForStatusTransition,
  type OrderStatusValue,
} from "@/lib/orders/order-status-workflow";
import { getPendingPaymentLock } from "@/lib/orders/pending-payment-lock";
import {
  getSubOrderPreorderCollectedAmount,
  refundOrderCancellation,
  reportFailedCancelRefund,
} from "@/lib/orders/preorder-cancel-refund";
import {
  afterPreorderScopeChange,
  preparePreorderCollection,
  type PreparationOutcome,
} from "@/lib/orders/preorder-collection";
import {
  preparationMessage,
  throwForPreparation,
} from "@/lib/orders/preorder-action-responses";
import { collectionScope } from "@/lib/orders/preorder-scope";
import {
  releaseOrderPreorders,
  releaseSubOrderPreorders,
} from "@/lib/orders/preorders";
import { ensureChargeTransaction } from "@/lib/payments/payment-transactions";
import { queueAutoShipForOrder } from "@/lib/shipping/carriers/shipment-worker";
import { voidLabelsForCancellation } from "@/lib/shipping/cancel-labels";

/**
 * Moving an order along its workflow — processing, shipped, delivered,
 * cancelled — the one way, for everybody who may do it.
 *
 * Two paths, as the website has two screens:
 *
 * - **The whole order** (an administrator, the store's staff, a seller's own
 *   staff on an order wholly their seller's): the status cascades onto every
 *   consignment the cascade may touch (`buildOrderStatusUpdates`), written
 *   once over the status the change was decided against, re-derived from the
 *   consignments afterwards (`reconcileOrderStatus`). `PUT
 *   /api/admin/orders/[id]`'s status path.
 * - **One consignment** (the seller): their own sub-order moves and the
 *   order's status is rolled up from its consignments (`rollUpOrderStatus`),
 *   saved only over the statuses the seller read. `PUT /api/vendor/orders/
 *   [id]`'s status path.
 *
 * Each path is in steps — prepare, write (or save), settle, complete — so the
 * website's routes, which write other fields in the same update (a payment
 * status by hand, notes, a refund) and keep their refund, payment-status and
 * override code, call the steps around their own write, while the business
 * app's `POST /orders/{id}/actions` (lib/api-core/biz/orders/action.ts)
 * takes `changeWholeOrderStatus` / `changeConsignmentStatus` whole. The
 * characterization suite (tests/order-actions-characterization.db.test.ts)
 * holds the website to what it answered before this module existed.
 *
 * What stays the same on every path: the pending-payment lock, the workflow,
 * the payment gate, the address hold, the race (written over what was read),
 * the restock and the pre-order release on a cancel, the labels voided, the
 * coupon's use handed back, the shopper told, auto-shipping kicked, the audit
 * row. A cancellation's refund is `refundOrderCancellation`'s, as before.
 *
 * Refusals are the website's own error classes, so its answers do not change,
 * each carrying a `reason` (`OrderActionReason`) the business app answers by.
 */

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

export const ORDER_ACTION_REASONS = {
  /** A mobile-money payment on it is still being settled. */
  paymentInFlight: "payment_in_flight",
  /** The step does not follow from where the order is. */
  transitionNotAllowed: "transition_not_allowed",
  /** A gateway order whose payment never arrived. */
  paymentNotReceived: "payment_not_received",
  /** Refunded in full: nothing is left to ship against. */
  paymentRefunded: "payment_refunded",
  /** A pre-order whose balance is still owed. */
  preorderBalanceDue: "preorder_balance_due",
  /** A pre-order that cannot be released yet (goods or sellers still waiting). */
  preorderNotReady: "preorder_not_ready",
  /** Shipping waits for the customer to check the delivery address. */
  addressOnHold: "address_on_hold",
  /** Collected at the counter, not shipped: the pickup actions move it. */
  pickupConsignment: "pickup_consignment",
  /** Somebody else moved the order between the read and the write. */
  orderStateChanged: "order_state_changed",
  /** A seller's staff may change only an order that is wholly their seller's. */
  otherSellersItems: "other_sellers_items",
} as const;

export type OrderActionReason = (typeof ORDER_ACTION_REASONS)[keyof typeof ORDER_ACTION_REASONS];

/** A refusal the website answers 400, with its reason beside the words. */
export class OrderActionRefusedError extends ValidationError {
  readonly reason: OrderActionReason;

  constructor(reason: OrderActionReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** A refusal the website answers 409 (the seller's race). */
export class OrderActionConflictError extends ConflictError {
  readonly reason: OrderActionReason;

  constructor(reason: OrderActionReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** A refusal the website answers 403. */
export class OrderActionForbiddenError extends AuthorizationError {
  readonly reason: OrderActionReason;

  constructor(reason: OrderActionReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** The reason an order action was refused for, when it was one of this module's. */
export function orderActionReason(error: unknown): OrderActionReason | null {
  if (
    error instanceof OrderActionRefusedError ||
    error instanceof OrderActionConflictError ||
    error instanceof OrderActionForbiddenError
  ) {
    return error.reason;
  }
  return null;
}

const GATE_REASONS: Record<FulfillmentPaymentBlockKind, OrderActionReason> = {
  not_paid: ORDER_ACTION_REASONS.paymentNotReceived,
  refunded: ORDER_ACTION_REASONS.paymentRefunded,
  balance_due: ORDER_ACTION_REASONS.preorderBalanceDue,
};

/** The website's wording for a consignment that moved between the read and the save. */
export const ORDER_CHANGED_MESSAGE =
  "This order changed while you were updating it. Refresh the page and try again.";

function assertNotLocked(order: { paymentMethod?: string | null; paymentStatus?: string | null; channel?: string | null }): void {
  const lock = getPendingPaymentLock(order);
  if (lock) throw new OrderActionRefusedError(ORDER_ACTION_REASONS.paymentInFlight, lock);
}

/**
 * The payment status a no-refund decision was made on: the business app's
 * cancel, which never refunds (D-B2). Given to a write, it makes the write
 * also require them unchanged, so a payment that lands between the check and
 * the write (Pay now, a gateway's webhook) makes the write miss
 * (`order_state_changed`) instead of cancelling, and refunding, what was just
 * paid. The website's paths never pass one: their cancel refunds.
 */
export interface PaymentAsRead {
  /** The order's. */
  paymentStatus: string | null;
  /** The cancelled consignment's own, when one consignment is cancelled. */
  consignmentPaymentStatus?: string | null;
}

/** The filter fields that hold a write to `read` (none without one). */
export function paymentGuard(read: PaymentAsRead | undefined, subOrderIndex?: number): Record<string, unknown> {
  if (!read) return {};
  return {
    paymentStatus: read.paymentStatus,
    ...(subOrderIndex !== undefined && read.consignmentPaymentStatus !== undefined
      ? { [`subOrders.${subOrderIndex}.paymentStatus`]: read.consignmentPaymentStatus }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Who is acting
// ---------------------------------------------------------------------------

/** The person moving the order, as every step needs them. */
export interface OrderActor {
  userId: string;
  /** Recorded in the gateway's audit trail: the email, else the id. */
  email?: string;
  /** Their staff scope; absent for an administrator. */
  staffScope?: StaffAccessScope;
  /** A seller created this staff member: whole orders of that seller only. */
  vendorOwned?: boolean;
}

const actorLabel = (actor: OrderActor) => actor.email || actor.userId;

// ---------------------------------------------------------------------------
// The whole order
// ---------------------------------------------------------------------------

type SubOrderRecord = SubOrderPaymentShape & {
  _id?: unknown;
  vendorId?: unknown;
  status?: string;
  items?: Array<{ preorderOutstandingAmount?: number | null; vendorId?: unknown }> | null;
  fulfillment?: { method?: string } | null;
};

/** The order as the whole-order path reads it (a lean document). */
export type OrderRecord = {
  _id: unknown;
  orderNumber?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string | null;
  channel?: string | null;
  currency?: string;
  hasPreorder?: boolean;
  subOrders?: SubOrderRecord[] | null;
  items?: Array<{ vendorId?: unknown }> | null;
  [field: string]: unknown;
};

export interface WholeOrderChange {
  status: OrderStatusValue;
  trackingNumber?: string;
  carrier?: string;
  cancelReason?: string;
}

export type WholeOrderPlan =
  | {
      kind: "write";
      /** The `$set` of the status change, to merge with the caller's own. */
      updates: Record<string, unknown>;
      /** The write happens only while the order still holds this status. */
      statusGuard: { status: unknown };
    }
  | {
      /** A waiting pre-order was released through the release service: nothing to write. */
      kind: "released";
      order: OrderRecord;
      outcome: PreparationOutcome;
    };

/**
 * Checks a whole-order status change against the order as read — the
 * pending-payment lock, a seller's staff's whole-order rule, the workflow,
 * the payment gate, the address hold — and either releases a waiting
 * pre-order (through the release service, which allocates its stock in the
 * same transaction; nothing is written afterwards) or returns the write.
 *
 * `override` is the administrator's escape hatch: the route has already
 * checked who may use it, and the workflow checks are what it skips.
 * `hasOtherChanges` says other fields ride in the same request, which a
 * pre-order release refuses.
 */
export async function prepareWholeOrderChange(params: {
  order: OrderRecord;
  change: WholeOrderChange;
  actor: OrderActor;
  override?: boolean;
  hasOtherChanges?: boolean;
}): Promise<WholeOrderPlan> {
  const { order, change, actor } = params;
  const currentStatus = String(order.status);

  if (!params.override) {
    assertNotLocked(order);
    assertVendorStaffMayChangeWholeOrder(actor, order);

    const transition = getOrderStatusActionByTarget(currentStatus, change.status);
    if (!transition) {
      throw new OrderActionRefusedError(
        ORDER_ACTION_REASONS.transitionNotAllowed,
        `Cannot transition order from "${currentStatus}" to "${change.status}". An admin can override this.`,
      );
    }

    // The same payment gate a vendor meets. An order whose card payment never
    // arrived — or that a chargeback has since refunded in full — could still
    // be packed and shipped from here, because only the vendor route asked.
    // An admin who knows better says so with an override.
    if (isFulfillmentTransition(change.status)) {
      const liveSubOrders = (order.subOrders || []).filter(
        (sub) => sub?.status !== ORDER_STATUS.CANCELLED,
      );
      const blocked = (liveSubOrders.length > 0 ? liveSubOrders : [null])
        .map((sub) =>
          describeFulfillmentPaymentBlock(
            order as Parameters<typeof describeFulfillmentPaymentBlock>[0],
            sub as Parameters<typeof describeFulfillmentPaymentBlock>[1],
          ),
        )
        .find(Boolean);
      if (blocked) {
        throw new OrderActionRefusedError(
          GATE_REASONS[blocked.kind],
          `${blocked.message} An admin can override this.`,
        );
      }
    }

    // A pre-order's goods are released through the shared release service,
    // which allocates their stock (and records what it took) in the same
    // transaction — never by a bare status write, which shipped units that
    // were never taken off the shelf. An admin who knows better overrides.
    const waitingPreorder = order.hasPreorder
      ? collectionScope(order as never).map((sub: { _id?: unknown }) => String(sub._id))
      : [];
    if (
      currentStatus === ORDER_STATUS.PREORDERED &&
      change.status === ORDER_STATUS.PROCESSING &&
      waitingPreorder.length > 0
    ) {
      if (params.hasOtherChanges) {
        throw new ValidationError(
          "Release the pre-order on its own first, then make the other changes.",
        );
      }
      const outcome = await preparePreorderCollection({
        orderId: String(order._id),
        actor: actor.userId,
        source: "admin",
        declare: waitingPreorder,
      });
      throwForPreparation(outcome);
      if (outcome.kind !== "released") {
        throw new OrderActionRefusedError(
          outcome.kind === "notice_pending" || outcome.kind === "balance_requested"
            ? ORDER_ACTION_REASONS.preorderBalanceDue
            : ORDER_ACTION_REASONS.preorderNotReady,
          preparationMessage(outcome, "admin") || "This pre-order could not be released yet",
        );
      }
      const fresh = (await Order.findById(order._id).lean()) as OrderRecord | null;
      return { kind: "released", order: fresh || order, outcome };
    }

    // A courier could not deliver to the address. Marking the order shipped
    // by hand would skip the one step that fixes that.
    if (
      (change.status === ORDER_STATUS.SHIPPED || change.status === ORDER_STATUS.DELIVERED) &&
      isAddressHoldOpen(order as Parameters<typeof isAddressHoldOpen>[0])
    ) {
      throw new OrderActionRefusedError(
        ORDER_ACTION_REASONS.addressOnHold,
        `${ADDRESS_HOLD_SHIPPING_BLOCK} Correct or confirm it first, or an admin can override this.`,
      );
    }
  }

  // Status, timestamps and the sub-order cascade all come from one shared
  // builder so the vendor route and carrier tracking write the same shape.
  const updates = buildOrderStatusUpdates({
    status: change.status,
    changedBy: actor.userId,
    trackingNumber: change.trackingNumber,
    carrier: change.carrier,
  });
  if (change.cancelReason) updates.cancelReason = change.cancelReason.trim();

  // Optimistic-concurrency guard for status transitions: the transition was
  // validated against the status as read, so the write requires the order to
  // STILL be in that status. Without this, two overlapping updates (ship +
  // cancel) both validate against the same stale read and the later write
  // regresses a shipped order to cancelled and wrongly restocks it.
  return { kind: "write", updates, statusGuard: { status: order.status } };
}

/**
 * A seller's own staff act for the seller, and the order screens write the
 * whole order — its status, tracking and notes reach every seller's parcel —
 * so they change only an order that is wholly their seller's.
 */
export function assertVendorStaffMayChangeWholeOrder(
  actor: Pick<OrderActor, "vendorOwned" | "staffScope">,
  order: Parameters<typeof isOrderEntirelyInScope>[0],
): void {
  if (actor.vendorOwned && !isOrderEntirelyInScope(order, actor.staffScope)) {
    throw new OrderActionForbiddenError(
      ORDER_ACTION_REASONS.otherSellersItems,
      "This order includes other sellers' items, so only the store can change it.",
    );
  }
}

/** The whole-order write, for a caller with nothing else to write beside the status. */
export async function writeWholeOrderChange(params: {
  orderId: string;
  plan: Extract<WholeOrderPlan, { kind: "write" }>;
  actor: OrderActor;
}): Promise<OrderRecord> {
  const { orderId, plan, actor } = params;
  const scope = buildStaffOrderScopeFilter(actor.staffScope);
  // Sub-order writes use the filtered positional operator so an order-level
  // change never clobbers a sub-order a vendor already cancelled (its status,
  // tracking, and timestamps must survive the parent transition).
  const order = (await Order.findOneAndUpdate(
    mergeScopeFilter({ _id: orderId, ...plan.statusGuard }, scope),
    { $set: plan.updates },
    { returnDocument: "after", runValidators: true, ...subOrderUpdateOptions(plan.updates) },
  )
    .populate("customerId", "name email")
    .lean()) as OrderRecord | null;
  if (order) return order;
  const stillExists = await Order.exists(mergeScopeFilter({ _id: orderId }, scope));
  if (stillExists) {
    throw new OrderActionRefusedError(
      ORDER_ACTION_REASONS.orderStateChanged,
      "Order was updated by someone else. Refresh and try again.",
    );
  }
  throw new NotFoundError("Order");
}

/**
 * Right after the write: the order's status re-derived from what the cascade
 * actually left behind (when a status was written), and cash on delivery
 * collected the moment it is delivered (whatever was written: the admin
 * route asks this of every update). Both change `order` in place, ahead of
 * the side effects that read them.
 */
export async function settleWholeOrderChange(
  order: OrderRecord,
  options: { statusChanged: boolean },
): Promise<void> {
  // The cascade spares consignments that have shipped or overtaken the
  // target, so on a split order the write may have landed only in part —
  // cancelling an order in which one vendor already delivered cancels the
  // other vendor and leaves a delivered order behind. Re-derive rather than
  // let the order-level badge claim something its goods never did.
  if (options.statusChanged) {
    const reconciled = await reconcileOrderStatus(
      order as Parameters<typeof reconcileOrderStatus>[0],
    );
    if (reconciled) order.status = reconciled;
  }

  // Cash on delivery is collected AT the delivery, so the order that has
  // just been marked delivered is paid — see `settleCodOnDelivery`, which
  // does nothing unless this really is an unpaid COD order. Ahead of the
  // side effects that read the payment status.
  if (order.status === ORDER_STATUS.DELIVERED) {
    const { settleCodOnDelivery } = await import("@/lib/orders/cod-collection");
    if (await settleCodOnDelivery(order._id)) order.paymentStatus = PAYMENT_STATUS.PAID;
  }
}

/** What a cancellation's refund came to, as the website reports it on the answer. */
export type CancellationRefund =
  | NonNullable<Awaited<ReturnType<typeof refundOrderCancellation>>>
  | { refunded: false; failed: true; reason: string };

/**
 * Everything a whole-order status change does after it is written: the
 * restock and the pre-order release on a cancel, the labels voided, the
 * cancellation's refund, the coupon's use handed back, the shopper told,
 * auto-shipping kicked, the audit row.
 */
export async function completeWholeOrderChange(params: {
  before: OrderRecord;
  order: OrderRecord;
  change: WholeOrderChange;
  actor: OrderActor;
  audit: AuditContext;
  /** The administrator's override, with its reason: its own audit row. */
  override?: { reason: string } | null;
  /** The caller's own reason to hand the coupon's use back (a full refund). */
  alsoReverseCoupon?: boolean;
}): Promise<{ cancellationRefund?: CancellationRefund }> {
  const { before, order, change, actor, audit } = params;
  const orderId = String(order._id);
  const currentStatus = String(before.status);

  // Restore inventory when order is cancelled. The helper claims the restore
  // atomically per sub-order, so abandoned-pending orders (no decrement ever
  // happened) are no-ops, and orders already partly restored by a vendor
  // cancel only restore the remaining sub-orders.
  if (shouldRestoreInventoryForStatusTransition(currentStatus, change.status)) {
    // An override reaches consignments that had already shipped or been
    // delivered, and by now they read `cancelled` — so the restore can no
    // longer tell them from goods still on the shelf. Named from the order as
    // it stood before the write: those goods are with a courier or a
    // customer, and only a return puts them back in stock.
    const dispatchedBefore = (before.subOrders || [])
      .filter((sub) => DISPATCHED_ORDER_STATUSES.includes(String(sub?.status || "")))
      .map((sub) => sub._id);
    await restoreOrderInventory(orderId, { excludeSubOrderIds: dispatchedBefore }).catch((err) =>
      console.error("Failed to restore inventory on admin cancel:", err),
    );
    await releaseOrderPreorders(orderId).catch((err) =>
      console.error("Failed to release preorder quota on admin cancel:", err),
    );
    // Labels bought for goods that are staying put. Only ones never handed
    // to the carrier; a parcel already on its way is beyond voiding.
    await voidLabelsForCancellation({ orderId: order._id }).catch((err) =>
      console.error("Failed to void labels on admin cancel:", err),
    );
    // A pre-order's open balance request goes with what it covered.
    if (before.hasPreorder) {
      await afterPreorderScopeChange(orderId).catch((err) =>
        console.error("Failed to reconcile a pre-order after an admin cancel:", err),
      );
    }
  }

  // Cancel means refund. The consignments this write actually cancelled are
  // the ones owed their share — a shipped sibling survives the cascade and
  // keeps its sale. An override included: it is the admin stating that the
  // order did not happen the way the record says, and skipping the refund
  // there left the shopper with neither the goods nor the money.
  let cancellationRefund: CancellationRefund | undefined;
  if (change.status === ORDER_STATUS.CANCELLED) {
    const wasCancelled = new Set(
      (before.subOrders || [])
        .filter((sub) => sub.status === ORDER_STATUS.CANCELLED)
        .map((sub) => String(sub._id)),
    );
    cancellationRefund = await refundOrderCancellation({
      orderId,
      cancelledSubOrderIds: (order.subOrders || [])
        .filter((sub) => sub.status === ORDER_STATUS.CANCELLED && !wasCancelled.has(String(sub._id)))
        .map((sub) => sub._id),
      reason: change.cancelReason?.trim() || "Order cancelled by the store",
      actor: actorLabel(actor),
      createdBy: actor.userId,
      auditContext: audit,
    }).catch((err: unknown) => {
      console.error("Failed to refund cancelled order:", err);
      return { refunded: false as const, failed: true as const, reason: "The refund could not be issued" };
    });
  }

  // Reverse coupon usage on cancellation (or a full refund, when the caller
  // says so). Read from the RECONCILED status, not from what was asked for: a
  // cancellation that only took the un-shipped half of a split order leaves
  // goods the customer is keeping, and the discount they used to buy them
  // stands.
  const movedToCancelled =
    order.status === ORDER_STATUS.CANCELLED && before.status !== ORDER_STATUS.CANCELLED;
  if (movedToCancelled || params.alsoReverseCoupon) {
    await reverseCouponUsageForOrder(orderId).catch((err) =>
      console.error("Failed to reverse coupon usage:", err),
    );
  }

  // Send customer notification and matching email. Keyed by the order rather
  // than its populated customer, which is null on a guest order.
  await notifyOrderStatus({ orderId, status: change.status }).catch((err) =>
    console.error("Failed to create order status notification:", err),
  );

  // Kick auto-shipping the moment a merchant moves an order to processing,
  // so they see a label appear rather than waiting for the next sweep. The
  // sweep is still what guarantees it happens — this only makes it prompt.
  if (change.status === ORDER_STATUS.PROCESSING) {
    afterResponse(() => queueAutoShipForOrder(orderId, actor.userId));
  }

  // The readable event first, so the timeline reads as a story.
  if (change.status !== before.status) {
    const ref = order as Parameters<typeof auditOrderStatus>[1];
    if (params.override) {
      // Its own action, never folded into an ordinary STATUS_CHANGE: the
      // whole point of the hatch is that using it is visible afterwards.
      await auditOrderStatusOverride(audit, ref, {
        from: currentStatus,
        to: change.status,
        reason: params.override.reason,
      });
    } else if (change.status === ORDER_STATUS.CANCELLED) {
      await auditOrderCancelled(audit, ref, {
        from: currentStatus,
        by: "admin",
        reason: change.cancelReason?.trim() || undefined,
      });
    } else {
      await auditOrderStatus(audit, ref, { from: currentStatus, to: change.status });
    }
  }

  return cancellationRefund ? { cancellationRefund } : {};
}

/**
 * The whole-order path, whole: prepare, write, settle, complete.
 * `paymentAsRead`: the write also requires the payment status read (see
 * `PaymentAsRead`).
 */
export async function changeWholeOrderStatus(params: {
  order: OrderRecord;
  change: WholeOrderChange;
  actor: OrderActor;
  audit: AuditContext;
  paymentAsRead?: PaymentAsRead;
}): Promise<{ order: OrderRecord; cancellationRefund?: CancellationRefund; outcome?: PreparationOutcome }> {
  const { change, actor, audit } = params;
  const before = params.order;
  const plan = await prepareWholeOrderChange({ order: before, change, actor });
  if (plan.kind === "released") return { order: plan.order, outcome: plan.outcome };

  const order = await writeWholeOrderChange({
    orderId: String(before._id),
    plan: { ...plan, statusGuard: { ...plan.statusGuard, ...paymentGuard(params.paymentAsRead) } },
    actor,
  });
  await settleWholeOrderChange(order, { statusChanged: true });
  if (order.paymentStatus === PAYMENT_STATUS.PAID) {
    const settings = await getSettings();
    await ensureChargeTransaction(
      chargeOrderShape(order, settings.general?.defaultCurrency),
    );
  }
  const { cancellationRefund } = await completeWholeOrderChange({
    before,
    order,
    change,
    actor,
    audit,
  });
  return { order, ...(cancellationRefund ? { cancellationRefund } : {}) };
}

// ---------------------------------------------------------------------------
// One consignment (the seller)
// ---------------------------------------------------------------------------

/** A sub-order as the consignment path moves it (a hydrated document's). */
type ConsignmentSubDocument = {
  _id: unknown;
  vendorId?: unknown;
  status?: string;
  paymentStatus?: string | null;
  fulfillment?: { method?: string } | null;
  trackingNumber?: string;
  carrier?: string;
  shippedAt?: Date;
  deliveredAt?: Date;
};

/** The order as the consignment path moves it: a hydrated document. */
export type OrderDocumentLike = {
  _id: unknown;
  orderNumber?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string | null;
  channel?: string | null;
  hasPreorder?: boolean;
  trackingNumber?: string;
  carrier?: string;
  subOrders: ConsignmentSubDocument[];
  save(): Promise<unknown>;
  toObject(): unknown;
  [field: string]: unknown;
};

export interface ConsignmentChange {
  status?: OrderStatusValue;
  trackingNumber?: string;
  carrier?: string;
}

/** The seller whose consignment moves. */
export interface ConsignmentVendor {
  id: string;
  storeName?: string;
}

/** What the consignment change was decided against, for the steps after the save. */
export interface ConsignmentFacts {
  /** The order as read, before anything was changed on it. */
  before: Record<string, unknown>;
  subOrderIndex: number;
  currentSubStatus: string;
  previousOverallStatus: string | undefined;
  previousPaymentStatus: string | undefined;
}

export type ConsignmentPlan =
  | { kind: "mutated"; facts: ConsignmentFacts }
  | { kind: "released"; order: Record<string, unknown>; outcome: PreparationOutcome };

/**
 * Checks a seller's change to their own consignment against the order as
 * read — the pending-payment lock, the pickup rule, the workflow, the payment
 * gate, the address hold — and makes it on the document: the consignment's
 * status and timestamps, its tracking (mirrored onto the order, where the
 * public tracking page reads it), and the order's status rolled up from its
 * consignments. A waiting pre-order consignment is released through the
 * release service instead, and nothing is saved afterwards.
 *
 * `before` is the document as read (`order.toObject()`), taken by the caller
 * before it changed anything else on it; `hasOtherChanges` says other fields
 * ride in the same request, which a pre-order release refuses.
 */
export async function prepareConsignmentChange(params: {
  order: OrderDocumentLike;
  before: Record<string, unknown>;
  subOrderIndex: number;
  change: ConsignmentChange;
  actor: OrderActor;
  hasOtherChanges?: boolean;
}): Promise<ConsignmentPlan> {
  const { order, before, subOrderIndex, change, actor } = params;
  const { status, trackingNumber, carrier } = change;
  const sub = order.subOrders[subOrderIndex];
  const currentSubStatus = String(sub.status);
  const isPickupSubOrder = sub.fulfillment?.method === "pickup";

  // Nothing moves while a mobile-money payment is still in flight: a vendor
  // calling their consignment off would restock goods the payer may be
  // paying for right now, on a provider that cannot refund automatically.
  if (status) assertNotLocked(order);

  if (isPickupSubOrder && (status || trackingNumber || carrier)) {
    if (status === ORDER_STATUS.CANCELLED) {
      // Cancellation follows the existing order workflow and frees capacity
      // below. All other pickup changes must use the dedicated lifecycle API.
    } else {
      throw new OrderActionRefusedError(
        ORDER_ACTION_REASONS.pickupConsignment,
        "Use the pickup actions to mark this order ready or collected",
      );
    }
  }

  if (status) {
    const transition = getOrderStatusActionByTarget(currentSubStatus, status);
    if (!transition) {
      throw new OrderActionRefusedError(
        ORDER_ACTION_REASONS.transitionNotAllowed,
        `Cannot transition sub-order from "${currentSubStatus}" to "${status}"`,
      );
    }

    // A waiting pre-order consignment is released only through the shared
    // release service, which allocates its stock in the same transaction —
    // "Mark goods available" in the vendor's own words.
    const ownSubId = String(sub._id);
    const isWaitingPreorder =
      currentSubStatus === ORDER_STATUS.PREORDERED &&
      status === ORDER_STATUS.PROCESSING &&
      collectionScope(order.toObject() as never).some(
        (candidate: { _id?: unknown }) => String(candidate._id) === ownSubId,
      );
    if (isWaitingPreorder) {
      if (trackingNumber || carrier || params.hasOtherChanges) {
        throw new ValidationError(
          "Mark the pre-order goods available on their own first, then make the other changes.",
        );
      }
      const outcome = await preparePreorderCollection({
        orderId: String(order._id),
        actor: actor.userId,
        source: "vendor",
        declare: [ownSubId],
        releaseScope: [ownSubId],
      });
      throwForPreparation(outcome, { vendorSubOrderIds: [ownSubId] });
      const fresh = (await Order.findById(order._id).lean()) as Record<string, unknown> | null;
      return { kind: "released", order: fresh || (order.toObject() as Record<string, unknown>), outcome };
    }

    // Goods do not move towards a shopper whose payment never arrived — see
    // the gate for what counts. Cancelling is never gated.
    if (isFulfillmentTransition(status)) {
      const blocked = describeFulfillmentPaymentBlock(
        order as Parameters<typeof describeFulfillmentPaymentBlock>[0],
        sub as Parameters<typeof describeFulfillmentPaymentBlock>[1],
      );
      if (blocked) throw new OrderActionRefusedError(GATE_REASONS[blocked.kind], blocked.message);
    }
    // The courier could not deliver to this address; the parcel waits until
    // the customer or the store corrects it.
    if (
      (status === ORDER_STATUS.SHIPPED || status === ORDER_STATUS.DELIVERED) &&
      isAddressHoldOpen(order as Parameters<typeof isAddressHoldOpen>[0])
    ) {
      throw new OrderActionRefusedError(ORDER_ACTION_REASONS.addressOnHold, ADDRESS_HOLD_SHIPPING_BLOCK);
    }

    sub.status = status;
    if (status === ORDER_STATUS.SHIPPED) sub.shippedAt = new Date();
    if (status === ORDER_STATUS.DELIVERED) sub.deliveredAt = new Date();
  }

  // Outside the status branch: a vendor may add the AWB, or correct the
  // courier, on a parcel that already shipped. Both are mirrored onto the
  // order, because that is where the public tracking page reads them from.
  // On a split order the order-level pair is a "most recent shipment"
  // summary, and the per-consignment truth stays on the sub-order.
  if (trackingNumber) {
    sub.trackingNumber = trackingNumber;
    order.trackingNumber = trackingNumber;
  }
  if (carrier) {
    sub.carrier = carrier;
    order.carrier = carrier;
  }

  // The order is a wrapper around consignments, so its status is derived
  // from theirs rather than guessed at here. Never backwards, though: see
  // `rollUpOrderStatus`. Its own timestamps go with it.
  const derivedStatus = rollUpOrderStatus(order.status, order.subOrders);
  if (derivedStatus) {
    Object.assign(order, getOrderStatusTimestampUpdates(derivedStatus));
    order.status = derivedStatus;
  }

  return {
    kind: "mutated",
    facts: {
      before,
      subOrderIndex,
      currentSubStatus,
      previousOverallStatus: (before as { status?: string }).status,
      previousPaymentStatus: (before as { paymentStatus?: string }).paymentStatus,
    },
  };
}

/**
 * Saves the document only over the order exactly as it was read: any status
 * on it that moved in between makes the save match nothing, and the seller
 * is asked to look again (409). A save that moved a consignment is a
 * versioned write in Mongoose, and a versioned write that matches nothing
 * throws VersionError rather than DocumentNotFoundError: the same news, the
 * same answer. `alsoAsRead` adds fields the save also requires unchanged
 * (`paymentGuard`).
 */
export async function saveConsignmentChange(
  order: OrderDocumentLike,
  before: Record<string, unknown>,
  alsoAsRead: Record<string, unknown> = {},
): Promise<void> {
  const readStatuses: Record<string, unknown> = { status: (before as { status?: string }).status };
  ((before as { subOrders?: Array<{ status?: string }> }).subOrders || []).forEach((sub, index) => {
    readStatuses[`subOrders.${index}.status`] = sub.status;
  });
  (order as unknown as { $where?: Record<string, unknown> }).$where = { ...readStatuses, ...alsoAsRead };
  try {
    await order.save();
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "DocumentNotFoundError" || name === "VersionError") {
      throw new OrderActionConflictError(ORDER_ACTION_REASONS.orderStateChanged, ORDER_CHANGED_MESSAGE);
    }
    throw err;
  }
}

/**
 * Right after the save: the consignment's stock and pre-order places back on
 * a cancel, its labels voided, the pre-order's balance request reconciled;
 * and the last parcel of a cash order delivered IS the collection, when the
 * cash was the seller's to confirm.
 */
export async function settleConsignmentChange(params: {
  order: OrderDocumentLike;
  change: ConsignmentChange;
  facts: ConsignmentFacts;
  vendor: ConsignmentVendor;
}): Promise<void> {
  const { order, change, facts, vendor } = params;
  const orderId = String(order._id);

  // Only once the cancellation is saved, so a save that lost the race above
  // hands nothing back. The helper claims the restore atomically, so a
  // sub-order that was never reserved is a no-op; one already restored
  // cannot be restored a second time.
  if (change.status === ORDER_STATUS.CANCELLED && facts.currentSubStatus !== ORDER_STATUS.CANCELLED) {
    await restoreSubOrderInventory({ orderId, vendorId: vendor.id }).catch((err) =>
      console.error("Failed to restore inventory on vendor sub-order cancel:", err),
    );
    await releaseSubOrderPreorders({ orderId, vendorId: vendor.id }).catch((err) =>
      console.error("Failed to release preorder quota on vendor sub-order cancel:", err),
    );
    // A label bought for goods that are now staying put was paid for the
    // moment it was bought. Only one never handed to the carrier is voided.
    await voidLabelsForCancellation({
      orderId: order._id,
      subOrderId: order.subOrders[facts.subOrderIndex]._id,
    }).catch((err) => console.error("Failed to void labels on vendor sub-order cancel:", err));
    // A pre-order whose balance request covered this consignment needs a
    // new one for what survives — or may now be ready to ask for it.
    if (order.hasPreorder) {
      await afterPreorderScopeChange(orderId).catch((err) =>
        console.error("Failed to reconcile a pre-order after a vendor cancel:", err),
      );
    }
  }

  // The last parcel on a cash order having been delivered IS the collection.
  // Guarded inside the helper on the order — not this consignment — being
  // delivered and still unpaid. Cash the store's courier took is not the
  // vendor's to confirm (`vendorDeliverySettlesCod`).
  if (order.status === ORDER_STATUS.DELIVERED) {
    const { settleCodOnDelivery, vendorDeliverySettlesCod } = await import("@/lib/orders/cod-collection");
    if (
      vendorDeliverySettlesCod(order as Parameters<typeof vendorDeliverySettlesCod>[0]) &&
      (await settleCodOnDelivery(order._id))
    ) {
      order.paymentStatus = PAYMENT_STATUS.PAID;
    }
  }
}

/**
 * The rest of a seller's change: the charge row, the points and the
 * customer's stats when the order just became paid; the shopper told when
 * the ORDER moved (a seller shipping their part of a split order does not
 * mean the whole order shipped); the coupon's use back when the order was
 * cancelled; auto-shipping kicked; the audit rows (the consignment's own
 * move, naming the seller, and the order's when it moved).
 */
export async function completeConsignmentChange(params: {
  order: OrderDocumentLike;
  change: ConsignmentChange;
  facts: ConsignmentFacts;
  actor: OrderActor;
  vendor: ConsignmentVendor;
  audit: AuditContext;
}): Promise<void> {
  const { order, change, facts, actor, vendor, audit } = params;
  const { status } = change;
  const orderId = String(order._id);

  if (order.paymentStatus === PAYMENT_STATUS.PAID && facts.previousPaymentStatus !== PAYMENT_STATUS.PAID) {
    const settings = await getSettings();
    await ensureChargeTransaction(
      chargeOrderShape(order, settings.general?.defaultCurrency),
    ).catch((err) =>
      console.error("Failed to record charge transaction on vendor mark-as-paid:", err),
    );

    const { awardOrderLoyaltyPoints, refreshCustomerStatsForOrder } = await import("@/lib/customers/customer");
    await awardOrderLoyaltyPoints(orderId).catch((err) =>
      console.error("Failed to award loyalty points:", err),
    );
    // COD money is only counted at this transition, so the customer's cached
    // stats go stale without a refresh here.
    refreshCustomerStatsForOrder(order as Parameters<typeof refreshCustomerStatsForOrder>[0]).catch((err) =>
      console.error("Failed to refresh customer stats:", err),
    );
  }

  if (status && String(order.status) !== String(facts.previousOverallStatus || "")) {
    await notifyOrderStatus({ orderId, status: String(order.status) }).catch((err) =>
      console.error("Failed to create vendor order status notification:", err),
    );
  }

  if (order.status === ORDER_STATUS.CANCELLED && facts.previousOverallStatus !== ORDER_STATUS.CANCELLED) {
    await reverseCouponUsageForOrder(orderId).catch((err) =>
      console.error("Failed to reverse coupon usage on vendor cancel:", err),
    );
  }

  // Same prompt-not-authoritative kick as the admin route: the eligibility
  // check runs per sub-order, so only this vendor's parcel is queued.
  if (status === ORDER_STATUS.PROCESSING) {
    afterResponse(() => queueAutoShipForOrder(orderId, actor.userId));
  }

  const ref = order as Parameters<typeof auditOrderStatus>[1];
  if (status && status !== facts.currentSubStatus) {
    const vendorName = vendor.storeName || undefined;
    if (status === ORDER_STATUS.CANCELLED) {
      await auditOrderCancelled(audit, ref, {
        from: facts.currentSubStatus,
        by: "admin",
        reason: vendorName ? `${vendorName} cancelled their items` : "Vendor cancelled their items",
      });
    } else {
      await auditOrderStatus(audit, ref, {
        from: facts.currentSubStatus,
        to: status,
        reason: vendorName ? `${vendorName}'s items` : undefined,
      });
    }
  }
  if (order.status !== facts.previousOverallStatus) {
    await auditOrderStatus(audit, ref, {
      from: String(facts.previousOverallStatus),
      to: String(order.status),
      reason: "all vendor shipments",
    });
  }
}

/**
 * A seller calling off a consignment the shopper already paid for sends that
 * consignment's share back. Only this consignment's share unless the
 * cancellation took the whole order with it. Reported, never thrown: the
 * cancellation has been saved and stands either way; a seller cannot send
 * the money, so the admins hear of a refund that did not go.
 */
export async function refundCancelledConsignment(params: {
  order: OrderDocumentLike;
  facts: ConsignmentFacts;
  actor: OrderActor;
  vendor: ConsignmentVendor;
  audit: AuditContext;
}): Promise<CancellationRefund | undefined> {
  const { order, facts, actor, vendor, audit } = params;
  return refundOrderCancellation({
    orderId: String(order._id),
    cancelledSubOrderIds: [order.subOrders[facts.subOrderIndex]._id],
    reason: vendor.storeName
      ? `${vendor.storeName} cancelled their items`
      : "Consignment cancelled by the seller",
    actor: actorLabel(actor),
    createdBy: actor.userId,
    auditContext: audit,
  }).catch(async (err: unknown) => {
    console.error("Failed to refund vendor-cancelled consignment:", err);
    await reportFailedCancelRefund({
      order: order as Parameters<typeof reportFailedCancelRefund>[0]["order"],
      why: err instanceof Error ? err.message : "the refund could not be issued",
    });
    return { refunded: false as const, failed: true as const, reason: "The refund could not be issued" };
  });
}

/**
 * The consignment path, whole: prepare, save, settle, complete, refund.
 * `paymentAsRead`: the save also requires the payment status read (see
 * `PaymentAsRead`).
 */
export async function changeConsignmentStatus(params: {
  order: OrderDocumentLike;
  subOrderIndex: number;
  change: ConsignmentChange;
  actor: OrderActor;
  vendor: ConsignmentVendor;
  audit: AuditContext;
  paymentAsRead?: PaymentAsRead;
}): Promise<{ order: Record<string, unknown>; cancellationRefund?: CancellationRefund; outcome?: PreparationOutcome }> {
  const { order, subOrderIndex, change, actor, vendor, audit } = params;
  const before = order.toObject() as Record<string, unknown>;
  const plan = await prepareConsignmentChange({ order, before, subOrderIndex, change, actor });
  if (plan.kind === "released") return { order: plan.order, outcome: plan.outcome };

  await saveConsignmentChange(order, before, paymentGuard(params.paymentAsRead, subOrderIndex));
  await settleConsignmentChange({ order, change, facts: plan.facts, vendor });
  await completeConsignmentChange({ order, change, facts: plan.facts, actor, vendor, audit });
  const cancellationRefund =
    change.status === ORDER_STATUS.CANCELLED && plan.facts.currentSubStatus !== ORDER_STATUS.CANCELLED
      ? await refundCancelledConsignment({ order, facts: plan.facts, actor, vendor, audit })
      : undefined;
  return {
    order: order.toObject() as Record<string, unknown>,
    ...(cancellationRefund ? { cancellationRefund } : {}),
  };
}

// ---------------------------------------------------------------------------
// Shared facts
// ---------------------------------------------------------------------------

/**
 * Whether cancelling would send money back: the whole order, or one
 * consignment's share. The website lets only an administrator cancel such
 * an order (the money has to be refunded); the business app refuses it
 * outright in its first release and sends the person to the website.
 *
 * It asks what `refundOrderCancellation` would send: a consignment's share
 * — on a deposit pre-order, its charge less the balance its own lines still
 * owe — unless cancelling it leaves no consignment live, which cancels the
 * order and refunds everything it collected.
 */
export function cancellationNeedsRefund(
  order: OrderRecord,
  options: { subOrderId?: unknown; defaultCurrency?: string } = {},
): boolean {
  const wholeOrderNeedsRefund = () =>
    getPreorderCollectedAmount(order as Parameters<typeof getPreorderCollectedAmount>[0]) > 0;
  if (options.subOrderId === undefined) return wholeOrderNeedsRefund();
  const subs = order.subOrders || [];
  const sub = subs.find((candidate) => String(candidate._id) === String(options.subOrderId));
  if (!sub) return false;
  const othersLive = subs.some(
    (other) => other !== sub && other.status !== ORDER_STATUS.CANCELLED,
  );
  if (!othersLive) return wholeOrderNeedsRefund();
  const priced = {
    ...order,
    currency: String(order.currency || options.defaultCurrency || "USD").toUpperCase(),
  } as Parameters<typeof getSubOrderPreorderCollectedAmount>[0];
  return getSubOrderPreorderCollectedAmount(priced, sub) > 0;
}

/** The order's fields `ensureChargeTransaction` reads, as the routes hand them over. */
function chargeOrderShape(order: OrderRecord | OrderDocumentLike, defaultCurrency: string | undefined) {
  const source = order as Record<string, unknown>;
  return {
    _id: String(order._id),
    orderNumber: source.orderNumber as string | undefined,
    paymentMethod: source.paymentMethod as string | undefined,
    paymentStatus: source.paymentStatus as string | undefined,
    paymentId: source.paymentId as string | undefined,
    stripePaymentIntentId: source.stripePaymentIntentId as string | undefined,
    paypalCaptureId: source.paypalCaptureId as string | undefined,
    razorpayPaymentId: source.razorpayPaymentId as string | undefined,
    paystackTransactionId: source.paystackTransactionId as string | undefined,
    pesapalConfirmationCode: source.pesapalConfirmationCode as string | undefined,
    subtotal: source.subtotal as number | undefined,
    shippingCost: source.shippingCost as number | undefined,
    tax: source.tax as number | undefined,
    discount: source.discount as number | undefined,
    total: source.total as number | undefined,
    paymentFee: source.paymentFee as number | undefined,
    paymentFeeCurrency: source.paymentFeeCurrency as string | undefined,
    paymentFeeRate: source.paymentFeeRate as number | undefined,
    currency: (source.currency as string | undefined) || defaultCurrency,
    channel: (source.channel as string | undefined) || "online",
    posLocationId: source.posLocationId ? String(source.posLocationId) : undefined,
    createdAt: source.createdAt as Date | undefined,
  } as Parameters<typeof ensureChargeTransaction>[0];
}
