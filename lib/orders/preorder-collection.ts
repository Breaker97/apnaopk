import { Types, type ClientSession } from "mongoose";
import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import { getSettings } from "@/models/settings.model";
import { PREORDER_ITEM_STATUS, PURCHASE_TYPE } from "@/lib/orders/preorders";
import { getPreorderBalanceDue } from "@/lib/orders/order-payment-status";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import {
  AllocationAbort,
  allocateConsignmentsInSession,
  loadAllocationPreferences,
  restoreAllocationsInSession,
  runAllocationAftermath,
  type InSessionAllocation,
  type StockBlocker,
} from "@/lib/orders/preorder-allocation";
import {
  ACTIVE_COLLECTION_STATES,
  collectionScope,
  cycleMismatch,
  isActiveCollection,
  isConsignmentReady,
  type ScopeSubOrder,
} from "@/lib/orders/preorder-scope";
import { findStaleTermsLines } from "@/lib/orders/preorder-terms";
import {
  ReleaseRefused,
  releaseConsignmentsInSession,
  releasePaymentBlock,
  requestPreorderRelease,
} from "@/lib/orders/preorder-release";
import {
  insertOperationInSession,
  releaseEffects,
  runPreorderOperation,
} from "@/lib/orders/preorder-operations";
import {
  runTransaction,
  TransactionContendedError,
  TransactionOutcomeUnknownError,
  TransactionsUnavailableError,
} from "@/lib/db-transaction";

/**
 * One balance per order, asked for only once every consignment is ready.
 *
 * A seller saying their goods are in used to ask the shopper for the WHOLE
 * order's balance and charge their saved card on the spot — while another
 * seller's goods on the same order were still months away. Readiness is now
 * declared per consignment (`subOrders[].preorderReadiness`) and changes
 * nothing else. The balance is asked for when the last live consignment is
 * declared ready: in one transaction every consignment's stock is allocated
 * (`preorder-allocation.ts`) and a collection cycle is written that binds the
 * request to exactly that scope, amount, currency and readiness. The cycle
 * starts `notice_pending`; nothing charges a card until the advance notice
 * has been accepted by the mail server and its window has passed
 * (`preorder-notice.ts`). A shopper may pay voluntarily at once.
 *
 * Stock that is short keeps the request closed — nothing is allocated for
 * anyone, and the merchant is told what is missing. A consignment cancelled
 * before the request leaves the scope and its share of the balance; one
 * cancelled after voids the cycle and a new one (with its own notice) is
 * prepared for what survives. An order with nothing left to pay is released
 * consignment by consignment as each seller is ready, through the shared
 * release service (`preorder-release.ts`).
 */

export type ReadinessSource = "vendor" | "admin" | "auto" | "legacy";

export type PreparationOutcome =
  | { kind: "waiting_for_vendors"; waitingCount: number }
  | { kind: "waiting_for_stock"; blockers: StockBlocker[] }
  | { kind: "notice_pending" | "balance_requested"; cycleId: string }
  | { kind: "released"; subOrderIds: string[] }
  | { kind: "in_progress"; retryAfterSeconds: number }
  | {
      kind:
        | "conflict"
        | "not_eligible"
        | "reconciliation_required"
        | "unavailable";
      reason: string;
    };

type CollectionOrder = {
  _id: Types.ObjectId;
  orderNumber: string;
  status?: string;
  currency?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  channel?: string;
  total?: number;
  hasPreorder?: boolean;
  goodsRefundedAt?: Date | null;
  preorderStatus?: string;
  preorderOutstandingAmount?: number;
  preorderBalancePaidAt?: Date | null;
  preorderBalanceRequestedAt?: Date | null;
  preorderBalanceChargeOutcome?: string | null;
  preorderMandateAcceptedAt?: Date | null;
  preorderSavedPaymentMethodId?: string | null;
  preorderReadinessRevision?: number | null;
  preorderCollection?: (Record<string, unknown> & {
    cycleId?: string;
    revision?: number;
    state?: string;
    scopeSubOrderIds?: unknown[];
    amount?: number;
    currency?: string;
    readinessRevision?: number;
    preparedAt?: Date;
    notice?: { acceptedAt?: Date | null } | null;
    paidAt?: Date;
  }) | null;
  subOrders?: Array<
    ScopeSubOrder & {
      _id: Types.ObjectId;
      vendorId?: unknown;
      paymentStatus?: string;
      fulfillment?: unknown;
      items?: Array<{
        productId?: unknown;
        variantId?: unknown;
        purchaseType?: string;
        quantity?: number;
        preorderStatus?: string;
        preorderOutstandingAmount?: number | null;
        preorderTermsRevision?: number | null;
      }>;
    }
  >;
};

const COLLECTION_FIELDS =
  "_id orderNumber status currency paymentStatus paymentMethod channel total hasPreorder goodsRefundedAt preorderStatus preorderOutstandingAmount preorderBalancePaidAt preorderBalanceRequestedAt preorderBalanceChargeOutcome preorderMandateAcceptedAt preorderSavedPaymentMethodId preorderReadinessRevision preorderCollection subOrders";

const id = (value: unknown) =>
  String((value as { _id?: unknown } | null)?._id ?? value ?? "");

function orderCurrency(order: CollectionOrder, fallback: string) {
  return String(order.currency || fallback || "USD").trim().toUpperCase();
}

/** Keep the last few requests on the order, newest last. */
const HISTORY_LIMIT = 10;

function historyEntry(
  cycle: NonNullable<CollectionOrder["preorderCollection"]>,
  now: Date,
  reason: string,
) {
  return {
    cycleId: cycle.cycleId,
    state: "void",
    amount: cycle.amount,
    currency: cycle.currency,
    preparedAt: cycle.preparedAt,
    noticeAcceptedAt: cycle.notice?.acceptedAt || undefined,
    voidedAt: now,
    voidReason: reason,
  };
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/**
 * Declare these consignments' goods available. Only waiting consignments are
 * touched, each once; nothing about the order's payment or any sibling moves.
 */
export async function declareReadinessInSession(params: {
  session?: ClientSession;
  orderId: string;
  subOrderIds: string[];
  actor: string;
  source: ReadinessSource;
  now: Date;
}): Promise<string[]> {
  const query = Order.findById(params.orderId).select(
    "_id subOrders._id subOrders.status subOrders.items.purchaseType subOrders.items.quantity subOrders.preorderReadiness",
  );
  if (params.session) query.session(params.session);
  const order = (await query.lean()) as CollectionOrder | null;
  if (!order) return [];
  const wanted = new Set(params.subOrderIds.map(String));
  const targets = collectionScope(order).filter(
    (sub) => wanted.has(id(sub._id)) && !isConsignmentReady(sub),
  );
  if (targets.length === 0) return [];
  const set: Record<string, unknown> = {};
  const arrayFilters: Record<string, unknown>[] = [];
  targets.forEach((sub, index) => {
    set[`subOrders.$[ready${index}].preorderReadiness`] = {
      declaredAt: params.now,
      declaredBy: params.actor,
      source: params.source,
    };
    arrayFilters.push({
      [`ready${index}._id`]: sub._id,
      [`ready${index}.status`]: ORDER_STATUS.PREORDERED,
    });
  });
  await Order.updateOne(
    { _id: order._id, status: { $ne: ORDER_STATUS.CANCELLED } },
    { $set: set, $inc: { preorderReadinessRevision: 1 } },
    { session: params.session, arrayFilters },
  );
  return targets.map((sub) => id(sub._id));
}

/**
 * Take a "goods available" back — only before the balance has been asked for.
 * Once a request stands, its stock is allocated and its notice may be out, so
 * withdrawing has to go through {@link resetPreparedCollection} (the delay
 * flow), which puts the stock back and voids the request together.
 */
export async function withdrawPreorderReadiness(params: {
  orderId: string;
  subOrderIds: string[];
  now?: Date;
}): Promise<{ withdrawn: string[]; refused?: "collection_prepared" }> {
  const now = params.now || new Date();
  void now;
  const order = (await Order.findById(params.orderId)
    .select("_id preorderCollection subOrders._id subOrders.status subOrders.items.purchaseType subOrders.items.quantity subOrders.preorderReadiness")
    .lean()) as CollectionOrder | null;
  if (!order) return { withdrawn: [] };
  const wanted = new Set(params.subOrderIds.map(String));
  if (
    isActiveCollection(order.preorderCollection) &&
    (order.preorderCollection?.scopeSubOrderIds || []).some((value) => wanted.has(id(value)))
  ) {
    return { withdrawn: [], refused: "collection_prepared" };
  }
  const targets = collectionScope(order).filter(
    (sub) => wanted.has(id(sub._id)) && isConsignmentReady(sub),
  );
  if (targets.length === 0) return { withdrawn: [] };
  const unset: Record<string, ""> = {};
  const arrayFilters: Record<string, unknown>[] = [];
  targets.forEach((sub, index) => {
    unset[`subOrders.$[withdraw${index}].preorderReadiness`] = "";
    arrayFilters.push({ [`withdraw${index}._id`]: sub._id });
  });
  await Order.updateOne(
    {
      _id: order._id,
      // Not over a request that landed after the read.
      "preorderCollection.state": { $nin: [...ACTIVE_COLLECTION_STATES] },
    },
    { $unset: unset, $inc: { preorderReadinessRevision: 1 } },
    { arrayFilters },
  );
  return { withdrawn: targets.map((sub) => id(sub._id)) };
}

// ---------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------

type PrepareResult =
  | { outcome: PreparationOutcome; allocation?: InSessionAllocation | null; releaseOperationId?: string; newCycle?: boolean };

/**
 * Prepare the order's balance request — or, when nothing is owed, release what
 * is ready — inside one transaction. See the module note.
 *
 * `declare` names consignments whose readiness this call declares first (a
 * seller's own, or an admin's explicit scope). `releaseScope` limits which
 * ready consignments a no-balance release may move: a seller releases only
 * their own. `requireDue` is the automatic release: it refuses an order whose
 * dates are not current.
 */
export async function preparePreorderCollection(params: {
  orderId: string;
  actor: string;
  source: ReadinessSource;
  declare?: string[];
  releaseScope?: string[];
  requireCurrentTerms?: boolean;
  now?: Date;
  /** Test seam: pause inside the transaction, after its read. */
  hooks?: { afterRead?: () => Promise<void> | void };
}): Promise<PreparationOutcome> {
  const now = params.now || new Date();
  if (!Types.ObjectId.isValid(params.orderId)) {
    return { kind: "not_eligible", reason: "order_missing" };
  }
  const base = (await Order.findById(params.orderId)
    .select("_id status subOrders._id subOrders.vendorId subOrders.fulfillment")
    .lean()) as Parameters<typeof loadAllocationPreferences>[0] | null;
  if (!base) return { kind: "not_eligible", reason: "order_missing" };
  const preferences = await loadAllocationPreferences(base);
  const settings = await getSettings();
  const policy = resolvePreorderPolicy(settings.preorder);
  const fallbackCurrency = String(settings.general?.defaultCurrency || "USD");
  const stamp = new Types.ObjectId().toHexString();

  // A person's "goods available" is a fact about their goods, kept whatever
  // the preparation then finds: committed first, so a stock shortage (which
  // rolls the preparation back) does not also erase it — the daily pass
  // prepares the order once the stock arrives. A declaration the system makes
  // on the store's behalf (the automatic release, a legacy adoption) is only
  // as good as the preparation it is part of, and goes with it.
  const personal =
    Boolean(params.declare?.length) && (params.source === "vendor" || params.source === "admin");
  if (personal) {
    try {
      await runTransaction("Declare pre-order readiness", (session) =>
        declareReadinessInSession({
          session,
          orderId: params.orderId,
          subOrderIds: params.declare as string[],
          actor: params.actor,
          source: params.source,
          now,
        }),
      );
    } catch (error) {
      return preparationOutcomeFromError(error);
    }
  }

  let result: PrepareResult;
  try {
    result = await runTransaction("Prepare pre-order balance", (session) =>
      prepareInSession({
        session,
        orderId: params.orderId,
        actor: params.actor,
        source: params.source,
        declare: personal ? undefined : params.declare,
        releaseScope: params.releaseScope,
        requireCurrentTerms: params.requireCurrentTerms,
        now,
        stamp,
        preferences,
        noticeHours: policy.balanceChargeNoticeHours,
        fallbackCurrency,
        hooks: params.hooks,
      }),
    );
  } catch (error) {
    return preparationOutcomeFromError(error);
  }
  if (result.allocation) await runAllocationAftermath(result.allocation);
  if (result.releaseOperationId) {
    await runPreorderOperation(result.releaseOperationId, { now }).catch((error) =>
      console.error("Failed to finish a pre-order release:", error),
    );
  }
  if (result.newCycle && "cycleId" in result.outcome) {
    // The notice goes out now where it can; the worker sends it otherwise.
    const cycleId = result.outcome.cycleId;
    await import("@/lib/orders/preorder-notice")
      .then(({ issuePreorderBalanceNotice }) =>
        issuePreorderBalanceNotice({ orderId: params.orderId, cycleId, now }),
      )
      .catch((error) => console.error("Failed to send a pre-order balance notice:", error));
  }
  return result.outcome;
}

export function preparationOutcomeFromError(error: unknown): PreparationOutcome {
  if (error instanceof AllocationAbort) {
    const outcome = error.outcome;
    if (outcome.kind === "insufficient_stock") {
      return { kind: "waiting_for_stock", blockers: outcome.blockers };
    }
    if (outcome.kind === "in_progress") return outcome;
    if (outcome.kind === "unavailable") return { kind: "unavailable", reason: outcome.reason };
    return { kind: outcome.kind, reason: outcome.reason };
  }
  if (error instanceof PreparationRefused) return error.outcome;
  if (error instanceof ReleaseRefused) {
    return { kind: "not_eligible", reason: error.reason };
  }
  if (error instanceof TransactionsUnavailableError) {
    return { kind: "unavailable", reason: error.message };
  }
  if (
    error instanceof TransactionContendedError ||
    error instanceof TransactionOutcomeUnknownError
  ) {
    return { kind: "in_progress", retryAfterSeconds: 5 };
  }
  throw error;
}

/** Ends a preparation with an answer and rolls back what it wrote. */
class PreparationRefused extends Error {
  readonly outcome: PreparationOutcome;

  constructor(outcome: PreparationOutcome) {
    super(`Preparation refused: ${outcome.kind}`);
    this.name = "PreparationRefused";
    this.outcome = outcome;
  }
}

async function prepareInSession(params: {
  session: ClientSession;
  orderId: string;
  actor: string;
  source: ReadinessSource;
  declare?: string[];
  releaseScope?: string[];
  requireCurrentTerms?: boolean;
  now: Date;
  stamp: string;
  preferences: Map<string, string[]>;
  noticeHours: number;
  fallbackCurrency: string;
  hooks?: { afterRead?: () => Promise<void> | void };
}): Promise<PrepareResult> {
  const { session, now } = params;
  if (params.declare?.length) {
    await declareReadinessInSession({
      session,
      orderId: params.orderId,
      subOrderIds: params.declare,
      actor: params.actor,
      source: params.source,
      now,
    });
  }
  const order = (await Order.findById(params.orderId)
    .session(session)
    .select(COLLECTION_FIELDS)
    .lean()) as CollectionOrder | null;
  await params.hooks?.afterRead?.();
  if (!order) return { outcome: { kind: "not_eligible", reason: "order_missing" } };
  if (order.status === ORDER_STATUS.CANCELLED) {
    return { outcome: { kind: "not_eligible", reason: "order_cancelled" } };
  }
  const scope = collectionScope(order);
  if (scope.length === 0) {
    return { outcome: { kind: "not_eligible", reason: "nothing_waiting" } };
  }
  const notReady = scope.filter((sub) => !isConsignmentReady(sub));
  const balanceDue = getPreorderBalanceDue(order);

  // ---- nothing owed: release what is ready (and the caller may move) ----
  if (balanceDue <= 0) {
    const block = releasePaymentBlock(order);
    if (block) return { outcome: { kind: "not_eligible", reason: block } };
    const allowed = params.releaseScope ? new Set(params.releaseScope.map(String)) : null;
    const releasable = scope.filter(
      (sub) => isConsignmentReady(sub) && (!allowed || allowed.has(id(sub._id))),
    );
    if (releasable.length === 0) {
      return { outcome: { kind: "waiting_for_vendors", waitingCount: notReady.length } };
    }
    const key = `release:${params.orderId}:manual:${params.stamp}`;
    const released = await releaseConsignmentsInSession({
      session,
      orderId: params.orderId,
      subOrderIds: releasable.map((sub) => id(sub._id)),
      source: params.source === "legacy" ? "legacy" : params.source,
      actor: params.actor,
      now,
      allocationOperationId: `alloc_${params.stamp}`,
      preferences: params.preferences,
      requireCurrentTerms: params.requireCurrentTerms,
      releaseOperationId: key,
    });
    const operation = await insertOperationInSession(session, {
      key,
      kind: "release",
      orderId: order._id,
      orderNumber: order.orderNumber,
      subOrderIds: released.released.map((value) => new Types.ObjectId(value)),
      actor: params.actor,
      source: params.source,
      reasonCode: "released",
      effects: releaseEffects().map((effect) =>
        effect.name === "transition"
          ? { ...effect, state: "done" as const, attempts: 1, completedAt: now }
          : effect,
      ),
      now,
    });
    // `preorderRelease.operationId` already names this release by its key
    // (written with the transition), as every path does.
    return {
      outcome: { kind: "released", subOrderIds: released.released },
      allocation: released.allocation,
      releaseOperationId: operation.operationId,
    };
  }

  // ---- a balance is owed: one request for the whole live scope ----
  const currency = orderCurrency(order, params.fallbackCurrency);
  const current = order.preorderCollection;
  const active = isActiveCollection(current) ? current : null;
  if (active) {
    const mismatch = cycleMismatch(order, active, balanceDue, currency);
    if (!mismatch) {
      return {
        outcome: {
          kind: active.state === "notice_pending" ? "notice_pending" : "balance_requested",
          cycleId: active.cycleId as string,
        },
      };
    }
    // A charge whose answer was lost belongs to the request it was made
    // for; a new request waits until the charge worker has settled it.
    if (order.preorderBalanceChargeOutcome === "unknown") {
      return { outcome: { kind: "conflict", reason: "charge_outcome_unknown" } };
    }
  }
  if (notReady.length > 0) {
    if (active) {
      // Cannot normally happen — withdrawing readiness under a live request is
      // refused — but a request that no longer describes the order must not
      // be left able to authorise a charge.
      await voidCycleInSession(session, order, "readiness_changed", now);
    }
    return { outcome: { kind: "waiting_for_vendors", waitingCount: notReady.length } };
  }
  if (params.requireCurrentTerms) {
    const stale = await findStaleTermsLines(order, session);
    if (stale.length > 0) {
      throw new PreparationRefused({ kind: "not_eligible", reason: "date_sync_pending" });
    }
  }

  const cycleId = new Types.ObjectId().toHexString();
  const allocation = await allocateConsignmentsInSession({
    session,
    orderId: params.orderId,
    subOrderIds: scope.map((sub) => id(sub._id)),
    operationId: `alloc_${cycleId}`,
    source: params.source === "legacy" ? "legacy" : params.source,
    now,
    preferences: params.preferences,
  });

  // Re-read for the revision the allocation left behind.
  const fresh = (await Order.findById(params.orderId)
    .session(session)
    .select("preorderReadinessRevision preorderCollection preorderCollectionHistory")
    .lean()) as (CollectionOrder & { preorderCollectionHistory?: unknown[] }) | null;
  const autoCharge = Boolean(
    order.preorderSavedPaymentMethodId && order.preorderMandateAcceptedAt,
  );
  const cycle = {
    cycleId,
    revision: Number(current?.revision || 0) + 1,
    state: "notice_pending",
    scopeSubOrderIds: scope.map((sub) => sub._id),
    amount: balanceDue,
    currency,
    readinessRevision: Number(fresh?.preorderReadinessRevision || 0),
    allocationOperationId: allocation.operationId,
    source: params.source,
    preparedAt: now,
    preparedBy: params.actor,
    noticeHours: params.noticeHours,
    autoCharge,
    notice: { attempt: 1, dedupeKey: `preorder-balance-notice:${cycleId}:1` },
  };
  const scopeVendorIds = scope.map((sub) => sub.vendorId);
  const set: Record<string, unknown> = {
    preorderCollection: cycle,
    preorderStatus: PREORDER_ITEM_STATUS.PAYMENT_DUE,
    "items.$[dueLine].preorderStatus": PREORDER_ITEM_STATUS.PAYMENT_DUE,
    statusChangedBy: params.actor,
    // A new request is a new dunning record: the attempts and the backoff of
    // the request it replaces do not carry over.
    preorderBalanceChargeAttempts: 0,
  };
  if (!order.preorderBalanceRequestedAt) set.preorderBalanceRequestedAt = now;
  const arrayFilters: Record<string, unknown>[] = [
    {
      "dueLine.purchaseType": PURCHASE_TYPE.PREORDER,
      "dueLine.vendorId": { $in: scopeVendorIds },
    },
    { "duePreorderLine.purchaseType": PURCHASE_TYPE.PREORDER },
  ];
  scope.forEach((sub, index) => {
    set[`subOrders.$[due${index}].items.$[duePreorderLine].preorderStatus`] =
      PREORDER_ITEM_STATUS.PAYMENT_DUE;
    arrayFilters.push({ [`due${index}._id`]: sub._id });
  });
  const history = [
    ...((fresh?.preorderCollectionHistory as unknown[]) || []),
    ...(current?.cycleId ? [historyEntry(current, now, active ? "replaced" : String(current.state || "void"))] : []),
  ].slice(-HISTORY_LIMIT);
  if (current?.cycleId) set.preorderCollectionHistory = history;
  const written = await Order.updateOne(
    { _id: order._id, status: { $ne: ORDER_STATUS.CANCELLED } },
    {
      $set: set,
      $unset: {
        preorderBalanceRemindersSent: "",
        preorderBalanceLastChargeAt: "",
        preorderBalanceLastChargeCode: "",
        preorderBalanceChargeOutcome: "",
        preorderBalanceChargeKey: "",
      },
    },
    { session, arrayFilters },
  );
  if (written.matchedCount !== 1) throw new TransactionContendedError("Prepare pre-order balance");
  return {
    outcome: { kind: "notice_pending", cycleId },
    allocation,
    newCycle: true,
  };
}

async function voidCycleInSession(
  session: ClientSession | undefined,
  order: CollectionOrder,
  reason: string,
  now: Date,
): Promise<void> {
  const cycle = order.preorderCollection;
  if (!cycle?.cycleId) return;
  await Order.updateOne(
    { _id: order._id, "preorderCollection.cycleId": cycle.cycleId },
    {
      $set: {
        "preorderCollection.state": "void",
        "preorderCollection.voidedAt": now,
        "preorderCollection.voidReason": reason,
      },
    },
    { session },
  );
}

// ---------------------------------------------------------------------------
// Reset — a delay or a withdrawal after preparation
// ---------------------------------------------------------------------------

/**
 * Take back a prepared request: void it, put its stock back on the shelf and
 * its places back on the reservation counter, and clear the readiness it was
 * built on — so the notice, the charge schedule and the stock all agree that
 * the goods are not ready after all. The caller writes the new date and the
 * waiting status in the same transaction (`session`).
 *
 * A balance already PAID is never touched: that money stays, and a date
 * change never triggers collection again.
 */
export async function resetPreparedCollectionInSession(params: {
  session: ClientSession;
  orderId: string;
  reason: string;
  now: Date;
  /** Only these consignments' readiness is cleared; the request goes whole. */
  subOrderIds?: string[];
}): Promise<{ reset: boolean; voidedCycleId?: string; restored: number }> {
  const { session, now } = params;
  const order = (await Order.findById(params.orderId)
    .session(session)
    .select(COLLECTION_FIELDS)
    .lean()) as CollectionOrder | null;
  if (!order) return { reset: false, restored: 0 };
  const cycle = order.preorderCollection;
  if (!isActiveCollection(cycle)) return { reset: false, restored: 0 };
  const scopeIds = (cycle.scopeSubOrderIds || []).map(id);
  // Units back on the shelf, places back on the counter, flagged reserved.
  const restored = await restoreAllocationsInSession({
    session,
    orderId: params.orderId,
    subOrderIds: scopeIds,
    mode: "unallocated",
    operationId: `reset_${cycle.cycleId}`,
    now,
  });
  const clear = new Set((params.subOrderIds || scopeIds).map(String));
  const unset: Record<string, ""> = {};
  const arrayFilters: Record<string, unknown>[] = [];
  collectionScope(order)
    .filter((sub) => clear.has(id(sub._id)))
    .forEach((sub, index) => {
      unset[`subOrders.$[unready${index}].preorderReadiness`] = "";
      arrayFilters.push({ [`unready${index}._id`]: sub._id });
    });
  const history = [
    ...(((order as unknown as { preorderCollectionHistory?: unknown[] }).preorderCollectionHistory) || []),
    historyEntry(cycle, now, params.reason),
  ].slice(-HISTORY_LIMIT);
  await Order.updateOne(
    { _id: order._id, "preorderCollection.cycleId": cycle.cycleId },
    {
      $set: {
        "preorderCollection.state": "void",
        "preorderCollection.voidedAt": now,
        "preorderCollection.voidReason": params.reason,
        preorderCollectionHistory: history,
      },
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      $inc: { preorderReadinessRevision: 1 },
    },
    { session, ...(arrayFilters.length > 0 ? { arrayFilters } : {}) },
  );
  return {
    reset: true,
    voidedCycleId: cycle.cycleId,
    restored: restored.restored.length,
  };
}

// ---------------------------------------------------------------------------
// After the money arrives, and after the scope changes
// ---------------------------------------------------------------------------

/**
 * The balance just settled (any route: card, PayPal, a receipt recorded by
 * hand). Mark the request paid, and release what it prepared — or, for a
 * request made before cycles existed, release on the old "the store asked"
 * meaning. A balance paid before anything was ready releases nothing: the
 * money is recorded truthfully and the goods wait for their sellers.
 */
export async function onPreorderBalanceSettled(params: {
  orderId: string;
  now?: Date;
}): Promise<{ released: boolean; operationId?: string | null }> {
  const now = params.now || new Date();
  const order = (await Order.findById(params.orderId)
    .select("_id status preorderStatus preorderCollection")
    .lean()) as CollectionOrder | null;
  if (!order || order.status === ORDER_STATUS.CANCELLED) return { released: false };
  const cycle = order.preorderCollection;
  if (isActiveCollection(cycle)) {
    const marked = await Order.updateOne(
      { _id: order._id, "preorderCollection.cycleId": cycle.cycleId },
      {
        $set: {
          "preorderCollection.state": "paid",
          "preorderCollection.paidAt": now,
        },
      },
    );
    if (marked.matchedCount !== 1) return { released: false };
    const { operationId } = await requestPreorderRelease({
      orderId: params.orderId,
      cycleId: cycle.cycleId,
      source: "settlement",
      now,
    });
    return { released: true, operationId };
  }
  if (!cycle?.cycleId && order.preorderStatus === PREORDER_ITEM_STATUS.PAYMENT_DUE) {
    // A request from before collection cycles: the store asked, the money is
    // in. Released through the same guarded path — stock and readiness
    // re-checked, recovery if the stock is not there.
    const { operationId } = await requestPreorderRelease({
      orderId: params.orderId,
      source: "legacy",
      now,
    });
    return { released: true, operationId };
  }
  // Paid before any request stood. The payment itself readies nothing: a
  // consignment whose seller already said the goods are in goes now — no
  // money is owed for it any more — and every other one waits for its seller.
  const outcome = await reconcilePreorderCollection({ orderId: params.orderId, now }).catch(
    (error) => {
      console.error("Failed to release a pre-order paid ahead of its request:", error);
      return null;
    },
  );
  return { released: outcome?.kind === "released" };
}

/**
 * A consignment was cancelled (or otherwise left the scope). If a request
 * stands for a scope that no longer exists, void it and prepare a new one for
 * what survives — with its own notice. If no request stands and every
 * surviving consignment is now ready, the balance is asked for at last.
 * Best-effort: the cron and the charge guard catch whatever this misses.
 */
export async function reconcilePreorderCollection(params: {
  orderId: string;
  now?: Date;
}): Promise<PreparationOutcome | null> {
  const now = params.now || new Date();
  const order = (await Order.findById(params.orderId)
    .select(COLLECTION_FIELDS)
    .lean()) as CollectionOrder | null;
  if (!order || order.status === ORDER_STATUS.CANCELLED || !order.hasPreorder) return null;
  const scope = collectionScope(order);
  if (scope.length === 0) return null;
  const active = isActiveCollection(order.preorderCollection) ? order.preorderCollection : null;
  const anyReady = scope.some(isConsignmentReady);
  if (!active && !anyReady) return null;
  return preparePreorderCollection({
    orderId: params.orderId,
    actor: "system",
    source: (active?.source as ReadinessSource | undefined) || "admin",
    now,
  });
}

/** Re-exported for the routes, which map outcomes to responses. */
export { ACTIVE_COLLECTION_STATES };

/**
 * Called by every cancellation path outside the pre-order screens (the order
 * page, the shopper's own cancel, a consignment cancelled by the store or a
 * seller): a whole order gone voids its open request; a part gone replaces it
 * with one for what survives, or asks for the balance now that every
 * surviving consignment is ready. Best-effort and idempotent.
 */
export async function afterPreorderScopeChange(orderId: string): Promise<void> {
  if (!Types.ObjectId.isValid(orderId)) return;
  const order = (await Order.findById(orderId)
    .select("_id status hasPreorder preorderCollection")
    .lean()) as Pick<CollectionOrder, "_id" | "status" | "hasPreorder" | "preorderCollection"> | null;
  if (!order?.hasPreorder) return;
  if (order.status === ORDER_STATUS.CANCELLED) {
    if (isActiveCollection(order.preorderCollection)) {
      await Order.updateOne(
        {
          _id: order._id,
          "preorderCollection.cycleId": order.preorderCollection?.cycleId,
          "preorderCollection.state": { $in: [...ACTIVE_COLLECTION_STATES] },
        },
        {
          $set: {
            "preorderCollection.state": "void",
            "preorderCollection.voidedAt": new Date(),
            "preorderCollection.voidReason": "cancelled",
          },
        },
      );
    }
    return;
  }
  await reconcilePreorderCollection({ orderId });
}
