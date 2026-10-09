import { Types, type ClientSession } from "mongoose";
import { Order, PaymentTransaction } from "@/models";
import {
  PreorderOperation,
  type IPreorderOperation,
  type PreorderOperationKind,
} from "@/models/preorder-operation.model";

/**
 * The durable tail of a pre-order lifecycle change.
 *
 * A cancellation or expiry commits its state, the stock it gives back and the
 * reservation places it frees in one transaction, together with one of these
 * operations describing what is still owed outside the database: labels to
 * void, the coupon use to hand back, the balance write-off and the refund to
 * post, the shopper to tell. A release does the same for allocating, moving
 * the consignments, queueing the label and the "ready" notice. This module
 * carries those effects out, one at a time, under a lease, recording each as
 * it lands — so a crash at any point resumes where it stopped instead of
 * losing the rest (the order may already have dropped out of whatever query
 * found it) or doing any of it twice.
 *
 * The refund is the one effect that moves money, and it is never retried
 * blind: an attempt is recorded before it is sent, and a run that finds an
 * attempt whose answer it never saw asks the books and the gateway what
 * happened before deciding anything (`reconcileRefundAttempt`).
 */

/** How long one worker may hold an operation before another may take it. */
export const OPERATION_LEASE_MS = 2 * 60 * 1000;

/** Waits between failed runs, in minutes; the last repeats. */
const RETRY_MINUTES = [1, 5, 30, 120, 360];

/** Failed runs of one effect before a person is asked to look. */
const ATTENTION_AFTER_ATTEMPTS = 6;

export type CancellationEffectName =
  | "void_labels"
  | "reverse_coupon"
  | "ledger_writeoff"
  | "refund"
  | "notify_customer";

export type ReleaseEffectName = "transition" | "queue_auto_ship" | "notify_ready";

export type OperationEffectName = CancellationEffectName | ReleaseEffectName;

/** What one run of an effect concluded. */
export type EffectResult =
  | { state: "done"; detail?: string }
  | { state: "skipped"; detail?: string }
  /** Try again later; counts towards attention. */
  | { state: "retry"; error: string; delayMinutes?: number }
  /** Blocked on the world (stock, a date propagation) — not a failure. */
  | { state: "waiting"; reason: string; detail?: string; delayMinutes?: number }
  /** A person has to act. */
  | { state: "attention"; reason: string; detail?: string }
  /** The order moved on and this work no longer applies. */
  | { state: "superseded"; reason: string };

export function retryDelayMs(attempts: number): number {
  const minutes = RETRY_MINUTES[Math.min(Math.max(attempts - 1, 0), RETRY_MINUTES.length - 1)];
  return minutes * 60_000;
}

export function cancellationEffects(params: {
  wholeOrder: boolean;
  /** False when the caller tells the shopper itself (or the shopper asked). */
  notifyCustomer?: boolean;
}): Array<{ name: CancellationEffectName; state: "pending" | "skipped"; attempts: number }> {
  return [
    { name: "void_labels", state: "pending", attempts: 0 },
    {
      name: "reverse_coupon",
      // A coupon use is the whole order's; a surviving consignment is still
      // being bought with it.
      state: params.wholeOrder ? "pending" : "skipped",
      attempts: 0,
    },
    { name: "ledger_writeoff", state: "pending", attempts: 0 },
    { name: "refund", state: "pending", attempts: 0 },
    {
      name: "notify_customer",
      state: params.notifyCustomer === false ? "skipped" : "pending",
      attempts: 0,
    },
  ];
}

export function releaseEffects(): Array<{
  name: ReleaseEffectName;
  state: "pending";
  attempts: number;
}> {
  return [
    { name: "transition", state: "pending", attempts: 0 },
    { name: "queue_auto_ship", state: "pending", attempts: 0 },
    { name: "notify_ready", state: "pending", attempts: 0 },
  ];
}

/**
 * Record an operation inside the caller's transaction, once per `key`.
 *
 * Read first on the same session rather than relying on the unique index to
 * reject a duplicate: a duplicate-key error aborts the whole transaction, and
 * the caller would lose the state change the operation describes.
 */
export async function insertOperationInSession(
  session: ClientSession,
  doc: {
    key: string;
    kind: PreorderOperationKind;
    orderId: unknown;
    orderNumber?: string;
    subOrderIds: unknown[];
    cycleId?: string;
    wholeOrder?: boolean;
    reasonCode?: string;
    reason?: string;
    actor: string;
    actorRole?: string;
    actorEmail?: string;
    source?: string;
    effects: IPreorderOperation["effects"];
    now: Date;
  },
): Promise<{ operationId: string; inserted: boolean }> {
  const existing = await PreorderOperation.findOne({ key: doc.key })
    .session(session)
    .select("_id")
    .lean<{ _id: Types.ObjectId } | null>();
  if (existing) return { operationId: String(existing._id), inserted: false };
  const created = await new PreorderOperation({
    key: doc.key,
    kind: doc.kind,
    orderId: doc.orderId,
    orderNumber: doc.orderNumber,
    subOrderIds: doc.subOrderIds,
    cycleId: doc.cycleId,
    wholeOrder: doc.wholeOrder,
    state: "pending",
    reasonCode: doc.reasonCode,
    reason: doc.reason,
    actor: doc.actor,
    ...(doc.actorRole ? { actorRole: doc.actorRole } : {}),
    ...(doc.actorEmail ? { actorEmail: doc.actorEmail } : {}),
    source: doc.source,
    effects: doc.effects,
    attempts: 0,
    nextAttemptAt: doc.now,
  } as Partial<IPreorderOperation>).save({ session });
  return { operationId: String(created._id), inserted: true };
}

type RunOutcome =
  | "completed"
  | "pending"
  | "waiting"
  | "attention"
  | "superseded"
  | "busy"
  | "missing";

/**
 * Carry out whatever this operation still owes, under a lease.
 *
 * `busy` when another worker holds it. Effects run in order and each is
 * persisted the moment it resolves, so the next run — after a crash, a
 * timeout, a retry — starts at the first one still pending.
 */
export async function runPreorderOperation(
  operationId: string,
  options: { now?: Date; owner?: string } = {},
): Promise<RunOutcome> {
  if (!Types.ObjectId.isValid(operationId)) return "missing";
  const now = options.now || new Date();
  const owner = options.owner || `run_${new Types.ObjectId().toHexString()}`;
  const claimed = await PreorderOperation.findOneAndUpdate(
    {
      _id: operationId,
      $or: [
        { state: { $in: ["pending", "waiting"] } },
        { state: "running", leaseUntil: { $lt: now } },
      ],
    },
    {
      $set: {
        state: "running",
        leaseOwner: owner,
        leaseUntil: new Date(now.getTime() + OPERATION_LEASE_MS),
        lastAttemptAt: now,
      },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after" },
  ).lean<IPreorderOperation | null>();
  if (!claimed) {
    const exists = await PreorderOperation.exists({ _id: operationId });
    return exists ? "busy" : "missing";
  }

  const finish = async (
    state: IPreorderOperation["state"],
    extra: Record<string, unknown> = {},
  ): Promise<void> => {
    await PreorderOperation.updateOne(
      { _id: claimed._id, leaseOwner: owner },
      {
        $set: { state, ...extra },
        $unset: { leaseOwner: "", leaseUntil: "" },
      },
    );
  };

  try {
    const runner =
      claimed.kind === "release"
        ? await import("@/lib/orders/preorder-release").then(
            (module) => module.runReleaseEffect,
          )
        : runCancellationEffect;

    for (const effect of claimed.effects) {
      if (effect.state === "done" || effect.state === "skipped") continue;
      if (effect.state === "attention") {
        await finish("attention");
        await syncOrderReleaseSummary(claimed, "attention");
        return "attention";
      }
      const result = await runner(
        effect.name as OperationEffectName,
        claimed,
        { now, owner },
      ).catch(
        (error: unknown): EffectResult => ({
          state: "retry",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      const attempts = Number(effect.attempts || 0) + 1;
      if (result.state === "done" || result.state === "skipped") {
        await setEffect(claimed._id, owner, effect.name, {
          state: result.state,
          attempts,
          completedAt: new Date(),
          ...(result.detail ? { detail: result.detail.slice(0, 500) } : {}),
        });
        effect.state = result.state;
        continue;
      }
      if (result.state === "superseded") {
        await setEffect(claimed._id, owner, effect.name, {
          state: "skipped",
          attempts,
          detail: result.reason,
        });
        await finish("superseded", { reasonCode: result.reason, completedAt: new Date() });
        await syncOrderReleaseSummary(claimed, "superseded", { reason: result.reason });
        return "superseded";
      }
      if (result.state === "waiting") {
        const delay = (result.delayMinutes ?? 0) * 60_000 || retryDelayMs(attempts);
        await setEffect(claimed._id, owner, effect.name, {
          state: "pending",
          attempts,
          lastError: (result.detail || result.reason).slice(0, 500),
        });
        await finish("waiting", {
          reasonCode: result.reason,
          nextAttemptAt: new Date(now.getTime() + delay),
          lastError: (result.detail || result.reason).slice(0, 500),
        });
        await syncOrderReleaseSummary(claimed, "waiting", {
          reason: result.reason,
          detail: result.detail,
          attempts: claimed.attempts,
          nextAttemptAt: new Date(now.getTime() + delay),
        });
        return "waiting";
      }
      if (result.state === "attention" || attempts >= ATTENTION_AFTER_ATTEMPTS) {
        const reason =
          result.state === "attention" ? result.reason : "side_effect_failed";
        const detail =
          result.state === "attention" ? result.detail || result.reason : result.error;
        await setEffect(claimed._id, owner, effect.name, {
          state: "attention",
          attempts,
          lastError: String(detail || reason).slice(0, 500),
        });
        await finish("attention", {
          reasonCode: reason,
          lastError: String(detail || reason).slice(0, 500),
        });
        await syncOrderReleaseSummary(claimed, "attention", { reason, detail });
        await reportOperationAttention(claimed, effect.name, reason, detail);
        return "attention";
      }
      // retry
      const delay = (result.delayMinutes ?? 0) * 60_000 || retryDelayMs(attempts);
      await setEffect(claimed._id, owner, effect.name, {
        state: "failed",
        attempts,
        lastError: result.error.slice(0, 500),
      });
      await finish("pending", {
        nextAttemptAt: new Date(now.getTime() + delay),
        lastError: result.error.slice(0, 500),
      });
      await syncOrderReleaseSummary(claimed, "waiting", {
        reason: "side_effect_failed",
        detail: result.error,
        nextAttemptAt: new Date(now.getTime() + delay),
      });
      return "pending";
    }
    await finish("completed", { completedAt: new Date(), lastError: undefined });
    return "completed";
  } catch (error) {
    // The lease runs out on its own; the next run picks this up.
    console.error(`Pre-order operation ${operationId} failed to run:`, error);
    await finish("pending", {
      nextAttemptAt: new Date(now.getTime() + retryDelayMs(claimed.attempts)),
      lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    }).catch(() => undefined);
    return "pending";
  }
}

async function setEffect(
  operationId: Types.ObjectId,
  owner: string,
  name: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const set: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fields)) {
    set[`effects.$[effect].${field}`] = value;
  }
  const written = await PreorderOperation.updateOne(
    { _id: operationId, leaseOwner: owner },
    { $set: set },
    { arrayFilters: [{ "effect.name": name }] },
  );
  if (written.matchedCount !== 1) {
    throw new Error("Lost the lease on a pre-order operation");
  }
}

/**
 * Keep the order's release summary in step with a release operation — the
 * screens read the summary, never the operation log.
 */
async function syncOrderReleaseSummary(
  operation: IPreorderOperation,
  state: "waiting" | "attention" | "superseded",
  details: {
    reason?: string;
    detail?: string;
    attempts?: number;
    nextAttemptAt?: Date;
  } = {},
): Promise<void> {
  if (operation.kind !== "release") return;
  await Order.updateOne(
    {
      _id: operation.orderId,
      // The order names its release by the operation's key, on every path.
      "preorderRelease.operationId": operation.key,
      "preorderRelease.state": { $ne: "released" },
    },
    {
      $set: {
        "preorderRelease.state": state,
        ...(details.reason ? { "preorderRelease.reason": details.reason.slice(0, 60) } : {}),
        ...(details.detail
          ? { "preorderRelease.detail": details.detail.slice(0, 500) }
          : {}),
        "preorderRelease.lastAttemptAt": new Date(),
        ...(details.nextAttemptAt
          ? { "preorderRelease.nextAttemptAt": details.nextAttemptAt }
          : {}),
      },
      $inc: { "preorderRelease.attempts": 1 },
    },
  ).catch((error) =>
    console.error("Failed to update a pre-order release summary:", error),
  );
}

async function reportOperationAttention(
  operation: IPreorderOperation,
  effect: string,
  reason: string,
  detail?: string,
): Promise<void> {
  const { notifyAdminsPaymentAnomaly } = await import(
    "@/lib/notifications/notifications"
  );
  await notifyAdminsPaymentAnomaly({
    title:
      operation.kind === "release"
        ? "A paid pre-order could not be released"
        : "A pre-order cancellation needs attention",
    message: `Order #${operation.orderNumber || String(operation.orderId)}: the ${effect.replace(/_/g, " ")} step stopped (${reason})${detail ? ` — ${detail}` : ""}. Open the order to retry it.`,
    dedupeKey: `preorder-operation:${String(operation._id)}:${effect}:${reason}`,
    link: `/admin/orders/${String(operation.orderId)}`,
  }).catch((error) =>
    console.error("Failed to report a pre-order operation needing attention:", error),
  );
}

// ---------------------------------------------------------------------------
// Cancellation and expiry effects
// ---------------------------------------------------------------------------

type CancelledOrder = {
  _id: Types.ObjectId;
  orderNumber: string;
  customerId?: unknown;
  guestEmail?: string;
  status?: string;
  refundedTotal?: number | null;
  refundInFlightAt?: Date | null;
  paymentMethod?: string;
  stripePaymentIntentId?: string;
  paymentId?: string;
  preorderBalancePaymentIntentId?: string;
  preorderReleaseDate?: Date;
};

async function loadCancelledOrder(orderId: unknown): Promise<CancelledOrder | null> {
  return Order.findById(orderId)
    .select(
      "_id orderNumber customerId guestEmail status refundedTotal refundInFlightAt paymentMethod stripePaymentIntentId paymentId preorderBalancePaymentIntentId preorderReleaseDate",
    )
    .lean<CancelledOrder | null>();
}

export async function runCancellationEffect(
  name: OperationEffectName,
  operation: IPreorderOperation,
  context: { now: Date; owner: string },
): Promise<EffectResult> {
  const orderId = String(operation.orderId);
  switch (name) {
    case "void_labels": {
      const { voidLabelsForCancellation } = await import("@/lib/shipping/cancel-labels");
      let failed = 0;
      let voided = 0;
      for (const subOrderId of operation.subOrderIds) {
        const result = await voidLabelsForCancellation({ orderId, subOrderId });
        failed += result.failed;
        voided += result.voided;
      }
      return failed > 0
        ? { state: "retry", error: `${failed} label(s) could not be voided` }
        : { state: "done", detail: voided > 0 ? `${voided} label(s) voided` : undefined };
    }
    case "reverse_coupon": {
      if (!operation.wholeOrder) return { state: "skipped" };
      const { reverseCouponUsageForOrder } = await import("@/lib/catalog/coupons");
      await reverseCouponUsageForOrder(orderId);
      return { state: "done" };
    }
    case "ledger_writeoff": {
      // Idempotent per consignment: the balance a cancellation leaves
      // uncollected comes off the receivable once, however often this runs.
      const { postBalanceWriteOff } = await import("@/lib/finance/post-events");
      await postBalanceWriteOff(operation.orderId);
      return { state: "done" };
    }
    case "refund":
      return runRefundEffect(operation, context);
    case "notify_customer":
      return runCancellationNotice(operation);
    default:
      return { state: "skipped" };
  }
}

/** Set fields on the operation's refund record, under the lease. */
async function setRefund(
  operation: IPreorderOperation,
  owner: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const set: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fields)) set[`refund.${field}`] = value;
  const written = await PreorderOperation.updateOne(
    { _id: operation._id, leaseOwner: owner },
    { $set: set },
  );
  if (written.matchedCount !== 1) throw new Error("Lost the lease on a pre-order operation");
}

/**
 * The refund for what this change called off — scoped to its consignments, or
 * everything collected when the whole order went — through the shared refund
 * flow, so the ledger, store credit, payouts and the gateway are handled the
 * way every other cancellation handles them.
 */
async function runRefundEffect(
  operation: IPreorderOperation,
  context: { now: Date; owner: string },
): Promise<EffectResult> {
  const existing = operation.refund;
  if (existing?.state === "succeeded" || existing?.state === "nothing") {
    return { state: "done", detail: existing.state };
  }
  if (existing?.state === "manual") {
    return {
      state: "attention",
      reason: "refund_manual",
      detail: "The refund was recorded but no gateway carried it — send it to the shopper by hand.",
    };
  }
  if (existing?.state === "submitting" || existing?.state === "unknown") {
    const reconciled = await reconcileRefundAttempt(operation, context);
    if (reconciled) return reconciled;
  }

  const order = await loadCancelledOrder(operation.orderId);
  if (!order) return { state: "attention", reason: "order_missing" };
  // A new attempt id only when the previous one is known not to have sent
  // anything (or this is the first): the id names the gateway request.
  const previous = Number(String(existing?.attemptId || "").split(":").pop());
  const attemptId = `${String(operation._id)}:refund:${
    Number.isFinite(previous) && previous > 0 ? previous + 1 : 1
  }`;
  await setRefund(operation, context.owner, {
    state: "submitting",
    attemptId,
    startedAt: context.now,
    refundedBefore: Number(order.refundedTotal || 0),
  });

  const { refundOrderCancellation } = await import("@/lib/orders/preorder-cancel-refund");
  const outcome = await refundOrderCancellation({
    orderId: String(operation.orderId),
    cancelledSubOrderIds: operation.subOrderIds,
    reason:
      operation.reason ||
      (operation.kind === "expire"
        ? "Pre-order expired — balance not paid"
        : "Pre-order cancelled"),
    actor: operation.actor === "system" ? "System (automatic)" : operation.actorEmail || operation.actor,
    createdBy: operation.actor === "system" ? undefined : operation.actor,
    // The person whose change this refund follows, not the worker running it.
    auditContext:
      operation.actor === "system"
        ? { userId: "system", userRole: "system" }
        : {
            userId: operation.actor,
            ...(operation.actorEmail ? { userEmail: operation.actorEmail } : {}),
            ...(operation.actorRole ? { userRole: operation.actorRole } : {}),
          },
    operationId: String(operation._id),
    idempotencyKey: `preorder-op:${attemptId}`,
  });

  if (!outcome) {
    await setRefund(operation, context.owner, {
      state: "nothing",
      completedAt: new Date(),
      reason: "Nothing was collected for what was cancelled",
    });
    return { state: "done", detail: "nothing collected" };
  }
  if (outcome.refunded && !outcome.failed) {
    const manual = outcome.gatewayCalled === false;
    await setRefund(operation, context.owner, {
      state: manual ? "manual" : "succeeded",
      amount: outcome.amount,
      currency: outcome.currency,
      gatewayCalled: outcome.gatewayCalled,
      completedAt: new Date(),
    });
    return manual
      ? {
          state: "attention",
          reason: "refund_manual",
          detail: "The refund was recorded but no gateway carried it — send it to the shopper by hand.",
        }
      : { state: "done", detail: `${outcome.amount} ${outcome.currency}` };
  }
  if (!outcome.refunded && !outcome.failed) {
    // "Already refunded" or "nothing collected": nothing is owed.
    await setRefund(operation, context.owner, {
      state: "nothing",
      completedAt: new Date(),
      reason: outcome.reason,
    });
    return { state: "done", detail: outcome.reason };
  }
  if (outcome.outcomeUnknown) {
    await setRefund(operation, context.owner, {
      state: "unknown",
      amount: outcome.amount,
      currency: outcome.currency,
      reason: outcome.reason,
    });
    return {
      state: "retry",
      error: outcome.reason || "The gateway did not answer",
      delayMinutes: 15,
    };
  }
  await setRefund(operation, context.owner, {
    state: "failed",
    amount: outcome.amount,
    currency: outcome.currency,
    reason: outcome.reason,
  });
  return {
    state: "attention",
    reason: "refund_failed",
    detail: outcome.reason,
  };
}

/**
 * An earlier run sent (or may have sent) this refund and never recorded the
 * answer. Decided from evidence, never from the absence of an answer:
 *
 *  1. a refund row this operation wrote → it went, and was recorded;
 *  2. the order's refund reservation is still in flight → wait for it;
 *  3. Stripe can be asked directly. A refund tagged with this operation that
 *     landed → it went: done once a refund row records it (the gateway's own
 *     report writes one), waiting until then. None → it did not go, so any
 *     reservation the crashed run left is handed back and the refund is sent
 *     again;
 *  4. otherwise: a run that reserved nothing and recorded nothing never
 *     reached the gateway and may simply run again; anything else is unknown,
 *     and a person checks the gateway.
 *
 * Every path that finds a reservation the crashed run left behind — money
 * reserved on `refundedTotal` with no refund row to account for it — hands it
 * back, so the order is not left refusing refunds it still owes.
 *
 * Returns null when the refund should be (re)submitted now.
 */
async function reconcileRefundAttempt(
  operation: IPreorderOperation,
  context: { now: Date; owner: string },
): Promise<EffectResult | null> {
  const attempt = operation.refund;
  const startedAt = attempt?.startedAt ? new Date(attempt.startedAt) : context.now;

  const ownRow = await PaymentTransaction.exists({
    orderId: operation.orderId,
    type: "refund",
    "metadata.preorderOperationId": String(operation._id),
  });
  if (ownRow) {
    await setRefund(operation, context.owner, {
      state: "succeeded",
      completedAt: new Date(),
      reason: "Recorded by an earlier run",
    });
    return { state: "done", detail: "recorded by an earlier run" };
  }

  const order = await loadCancelledOrder(operation.orderId);
  if (!order) return { state: "attention", reason: "order_missing" };
  const { isRefundInFlight } = await import("@/lib/orders/refund-in-flight");
  if (isRefundInFlight(order, context.now)) {
    return {
      state: "retry",
      error: "A refund on this order is still being recorded",
      delayMinutes: 5,
    };
  }

  // Reservations made since the attempt began that no refund row accounts
  // for — what a run that crashed between reserving and recording left.
  const [since] = await PaymentTransaction.aggregate<{ total: number }>([
    {
      $match: {
        orderId: operation.orderId,
        type: "refund",
        status: "succeeded",
        createdAt: { $gte: new Date(startedAt.getTime() - 1000) },
      },
    },
    { $group: { _id: null, total: { $sum: "$grossAmount" } } },
  ]);
  const recordedSince = Number(since?.total || 0);
  const excess =
    Number(order.refundedTotal || 0) -
    Number(attempt?.refundedBefore || 0) -
    recordedSince;
  const releaseExcess = async () => {
    if (excess <= 0.005) return;
    await Order.updateOne(
      { _id: order._id, refundedTotal: order.refundedTotal },
      { $inc: { refundedTotal: -Number(excess.toFixed(2)) } },
    );
  };

  const verdict = await findStripeRefundForOperation(order, String(operation._id));
  if (verdict.kind === "landed") {
    const recorded = await PaymentTransaction.exists({
      orderId: operation.orderId,
      type: "refund",
      $or: [
        { externalId: verdict.refundId },
        { "metadata.gatewayRefundIds": verdict.refundId },
      ],
    });
    if (recorded) {
      await releaseExcess();
      await setRefund(operation, context.owner, {
        state: "succeeded",
        completedAt: new Date(),
        reason: "Recorded from the gateway's own report",
      });
      return { state: "done", detail: "recorded from the gateway's report" };
    }
    // The money went; the gateway's report records it. Waiting for it rather
    // than writing a second row beside it — and handing back the crashed
    // run's reservation so the report can make its own.
    await releaseExcess();
    return {
      state: "retry",
      error: "The refund went through at the gateway and is waiting to be recorded",
      delayMinutes: 15,
    };
  }
  if (verdict.kind === "absent") {
    await releaseExcess();
    return null;
  }
  if (excess <= 0.005 && recordedSince === 0 && attempt?.state === "submitting") {
    // Nothing reserved and nothing recorded: the run stopped before the
    // gateway was ever asked.
    return null;
  }
  return {
    state: "attention",
    reason: "refund_outcome_unknown",
    detail:
      "It is not known whether this refund reached the shopper. Check the payment gateway before refunding again.",
  };
}

/**
 * Ask Stripe whether a refund tagged with this operation exists on the order's
 * charges. `unknown` for anything but a card order, or when Stripe cannot be
 * asked — the caller then does not guess.
 */
async function findStripeRefundForOperation(
  order: CancelledOrder,
  operationId: string,
): Promise<
  | { kind: "landed"; refundId: string }
  | { kind: "absent" }
  | { kind: "unknown" }
> {
  const method = String(order.paymentMethod || "").toLowerCase();
  if (method !== "card" && method !== "stripe") return { kind: "unknown" };
  const intents = [
    order.stripePaymentIntentId || order.paymentId,
    order.preorderBalancePaymentIntentId,
  ].filter((value): value is string => Boolean(value) && String(value).startsWith("pi_"));
  if (intents.length === 0) return { kind: "unknown" };
  try {
    const { getSettings } = await import("@/models/settings.model");
    const { resolveStripeCredentials } = await import("@/lib/settings/credentials");
    const { getStripeForSecretKey, isStripeSecretKeyConfigured } = await import(
      "@/lib/payments/stripe"
    );
    const settings = await getSettings();
    const secretKey = resolveStripeCredentials(settings.payment?.stripe).secretKey;
    if (!isStripeSecretKeyConfigured(secretKey)) return { kind: "unknown" };
    const stripe = getStripeForSecretKey(secretKey);
    for (const intentId of intents) {
      const refunds = await stripe.refunds.list({ payment_intent: intentId, limit: 100 });
      const landed = refunds.data.find(
        (refund) =>
          refund.metadata?.preorderOperation === operationId &&
          refund.status !== "failed" &&
          refund.status !== "canceled",
      );
      if (landed) return { kind: "landed", refundId: landed.id };
    }
    return { kind: "absent" };
  } catch (error) {
    console.error("Failed to ask Stripe about a pre-order refund:", error);
    return { kind: "unknown" };
  }
}

/** The shopper hears what happened, and what became of their money. */
async function runCancellationNotice(
  operation: IPreorderOperation,
): Promise<EffectResult> {
  const order = await loadCancelledOrder(operation.orderId);
  if (!order) return { state: "skipped", detail: "order missing" };
  if (!order.customerId && !order.guestEmail) {
    return { state: "skipped", detail: "no contact on the order" };
  }
  const fresh = await PreorderOperation.findById(operation._id)
    .select("refund")
    .lean<Pick<IPreorderOperation, "refund"> | null>();
  const refund = fresh?.refund;
  const refundOutcome =
    refund?.state === "succeeded"
      ? "refunded"
      : refund?.state === "nothing" || !refund
        ? "none"
        : refund?.state === "manual"
          ? "manual"
          : "processing";
  const { notifyPreorderCustomerUpdate } = await import(
    "@/lib/notifications/notifications"
  );
  await notifyPreorderCustomerUpdate(
    String(order.customerId || ""),
    order.orderNumber,
    operation.kind === "expire" ? "expired" : "cancelled",
    String(order._id),
    {
      releaseDate: order.preorderReleaseDate,
      guestEmail: order.guestEmail,
      refundOutcome,
      ...(operation.wholeOrder ? {} : { partOfOrder: true }),
    },
  );
  return { state: "done", detail: refundOutcome };
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export type OperationSweepSummary = {
  processed: number;
  completed: number;
  pending: number;
  waiting: number;
  attention: number;
  superseded: number;
  busy: number;
};

/**
 * Run due operations, oldest due first, within a time budget.
 *
 * Fair by construction: an operation that cannot progress (stock not in, a
 * gateway refusing) is pushed back by its own `nextAttemptAt`, so it cannot
 * keep the head of the queue from the ones behind it.
 */
export async function processPreorderOperations(
  options: { limit?: number; budgetMs?: number; now?: Date; kinds?: PreorderOperationKind[] } = {},
): Promise<OperationSweepSummary> {
  const now = options.now || new Date();
  const started = Date.now();
  const budgetMs = options.budgetMs ?? 25_000;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const summary: OperationSweepSummary = {
    processed: 0,
    completed: 0,
    pending: 0,
    waiting: 0,
    attention: 0,
    superseded: 0,
    busy: 0,
  };
  const kindFilter = options.kinds ? { kind: { $in: options.kinds } } : {};
  const due = await PreorderOperation.find({
    ...kindFilter,
    $or: [
      { state: { $in: ["pending", "waiting"] }, nextAttemptAt: { $lte: now } },
      { state: "running", leaseUntil: { $lt: now } },
    ],
  })
    .sort({ nextAttemptAt: 1, _id: 1 })
    .limit(limit)
    .select("_id")
    .lean<Array<{ _id: Types.ObjectId }>>();

  for (const { _id } of due) {
    if (Date.now() - started > budgetMs) break;
    const outcome = await runPreorderOperation(String(_id), { now });
    summary.processed += 1;
    if (outcome === "completed") summary.completed += 1;
    else if (outcome === "pending") summary.pending += 1;
    else if (outcome === "waiting") summary.waiting += 1;
    else if (outcome === "attention") summary.attention += 1;
    else if (outcome === "superseded") summary.superseded += 1;
    else if (outcome === "busy") summary.busy += 1;
  }
  return summary;
}

/** Durable counts for cron health and the admin screens. */
export async function countPreorderOperations(): Promise<
  Record<PreorderOperationKind, Record<string, number>>
> {
  const rows = await PreorderOperation.aggregate<{
    _id: { kind: PreorderOperationKind; state: string };
    count: number;
  }>([
    { $match: { state: { $in: ["pending", "running", "waiting", "attention"] } } },
    { $group: { _id: { kind: "$kind", state: "$state" }, count: { $sum: 1 } } },
  ]);
  const counts = {
    expire: {},
    cancel: {},
    release: {},
  } as Record<PreorderOperationKind, Record<string, number>>;
  for (const row of rows) counts[row._id.kind][row._id.state] = row.count;
  return counts;
}

/**
 * Put an operation that stopped for a person back in the queue — the Retry
 * button. Failed effects become pending again; a refund whose outcome was
 * unknown is reconciled again first, never resent blind.
 */
export async function retryPreorderOperation(
  operationId: string,
  options: { now?: Date } = {},
): Promise<RunOutcome> {
  if (!Types.ObjectId.isValid(operationId)) return "missing";
  const now = options.now || new Date();
  const reset = await PreorderOperation.findOneAndUpdate(
    { _id: operationId, state: { $in: ["attention", "waiting", "pending"] } },
    {
      $set: {
        state: "pending",
        nextAttemptAt: now,
        "effects.$[stuck].state": "pending",
        "effects.$[stuck].attempts": 0,
      },
    },
    { arrayFilters: [{ "stuck.state": { $in: ["attention", "failed"] } }] },
  ).lean();
  if (!reset) return "missing";
  return runPreorderOperation(operationId, { now });
}
