import "server-only";

import { Types } from "mongoose";
import { Order } from "@/models";
import { Shipment } from "@/models/shipment.model";
import {
  ShipmentJob,
  type IShipmentJob,
  type ShipmentJobKind,
  type ShipmentJobStatus,
} from "@/models/shipment-job.model";
import { getSettings } from "@/models/settings.model";
import { ORDER_STATUS } from "@/config/app.config";
import type { IOrder, SubOrder } from "@/types";
import type { CarrierProvider } from "@/lib/shipping/carrier-config";
import { isAutoShipEligible } from "@/lib/shipping/automation";
import { CarrierError } from "./errors";
import { clearCarrierAuthFailure, flagCarrierAuthFailure } from "./health";
import {
  purchaseShipmentLabel,
  rateShopSubOrder,
  refreshShipmentTracking,
  selectQuote,
  voidShipmentLabel,
} from "./fulfillment";
import { carrierAdapter } from "./registry";
import { applyShipmentTrackingToOrder } from "@/lib/shipping/tracking-cascade";

/**
 * The carrier work queue's worker.
 *
 * Structurally identical to `lib/conversations/providers/outbox.ts` — same
 * lease, same backoff ladder, same dead-letter sentinel — because it solves
 * the same problem for a different provider family, and having two retry
 * policies in one codebase is how one of them ends up wrong.
 */

const MAX_ATTEMPTS = 6;
const LEASE_MS = 60_000;
/**
 * How long one cron invocation keeps claiming work. The route's `maxDuration`
 * is 60s and a single carrier call can block for its full timeout, so a
 * count-only bound could ask for more wall clock than the function has.
 */
const BATCH_BUDGET_MS = 45_000;

const DEAD_LETTER_AT = new Date("9999-12-31T23:59:59.999Z");
const DONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const FAILED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Kinds that are expected to run again for the same target.
 *
 * A parcel is polled for its whole journey, so its `sync_tracking` row is
 * revisited every time a webhook lands or the sweep comes round. Buying a label
 * is the opposite: one row, one purchase.
 */
const RECURRING_JOB_KINDS: ReadonlySet<ShipmentJobKind> = new Set([
  "sync_tracking",
]);

/**
 * How long a dead-lettered recurring job is left alone before one more chance.
 *
 * A dead letter is a signal for a human, so it is not revived on the next tick.
 * But a parcel whose tracking stays dead for the rest of its life is worse than
 * an occasional wasted poll, so a recurring job gets retried after a cool-off.
 */
const DEAD_LETTER_RETRY_MS = 6 * 60 * 60 * 1000;

function retentionDate(milliseconds: number) {
  return new Date(Date.now() + milliseconds);
}

function retryAt(attempts: number, minimumSeconds = 0) {
  const delaySeconds = Math.max(
    minimumSeconds,
    Math.min(15 * 60, 5 * 2 ** Math.max(0, attempts - 1)),
  );
  return new Date(Date.now() + delaySeconds * 1000);
}

/**
 * The states a settled job row may be reopened from, as an `$or` clause.
 *
 * Exported because this is the whole difference between "enqueue is idempotent"
 * and "enqueue is a one-time event", and getting it wrong is invisible until a
 * parcel silently stops updating a week later.
 */
export function revivableJobStates(
  kind: ShipmentJobKind,
  now: Date = new Date(),
): Record<string, unknown>[] {
  // A finished row says nothing about whether the next trigger is real work:
  // the eligibility predicate and the tracking fetch both re-decide that at
  // execution time.
  const states: Record<string, unknown>[] = [{ status: "done" }];

  if (RECURRING_JOB_KINDS.has(kind)) {
    states.push({
      status: "failed",
      // Only a dead letter — a row still on the retry ladder is already due to
      // run, and resetting its attempt count would restart the backoff.
      nextAttemptAt: { $gte: DEAD_LETTER_AT },
      deadLetteredAt: {
        $type: "date",
        $lte: new Date(now.getTime() - DEAD_LETTER_RETRY_MS),
      },
    });
  }

  return states;
}

function isSettledJobStatus(status: ShipmentJobStatus): boolean {
  return status === "done" || status === "failed";
}

/**
 * Enqueue idempotently.
 *
 * The unique index on {orderId, subOrderId, shipmentId, kind} plus
 * `$setOnInsert` means the inline hook and the cron sweep can both call this
 * for the same sub-order and only one job exists.
 *
 * That index is also why a *settled* row has to be revived rather than matched
 * and ignored. `$setOnInsert` alone is a no-op against an existing document, so
 * a completed `sync_tracking` row would swallow every webhook and every sweep
 * that followed it — a parcel would be tracked exactly once, then never again
 * until the TTL reaped the row a week later.
 */
export async function enqueueShipmentJob(params: {
  orderId: Types.ObjectId | string;
  subOrderId?: Types.ObjectId | string;
  vendorId?: Types.ObjectId | string;
  shipmentId?: Types.ObjectId | string;
  kind: ShipmentJobKind;
  provider?: CarrierProvider;
  requestedBy?: string;
  payload?: IShipmentJob["payload"];
}) {
  const job = await ShipmentJob.findOneAndUpdate(
    {
      orderId: params.orderId,
      subOrderId: params.subOrderId ?? null,
      shipmentId: params.shipmentId ?? null,
      kind: params.kind,
    },
    {
      $setOnInsert: {
        orderId: params.orderId,
        subOrderId: params.subOrderId ?? null,
        shipmentId: params.shipmentId ?? null,
        vendorId: params.vendorId,
        kind: params.kind,
        provider: params.provider,
        requestedBy: params.requestedBy || "system",
        payload: params.payload,
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (!job || !isSettledJobStatus(job.status)) return job;

  // Guarded by the same states in the filter rather than by what was just read,
  // so a worker claiming the row between the two calls wins instead of being
  // reset out from under itself.
  await ShipmentJob.updateOne(
    { _id: job._id, $or: revivableJobStates(params.kind) },
    {
      $set: {
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
        leaseUntil: null,
        lastError: null,
        lastErrorCode: null,
        deadLetteredAt: null,
        // Live work must never carry a TTL, or the reaper takes it mid-flight.
        expiresAt: null,
        ...(params.provider ? { provider: params.provider } : {}),
        ...(params.payload ? { payload: params.payload } : {}),
      },
    },
  );

  return job;
}

async function claimShipmentJob() {
  const now = new Date();
  return ShipmentJob.findOneAndUpdate(
    {
      // An expired lease is reclaimed after a worker crash.
      status: { $in: ["pending", "failed", "processing"] },
      attempts: { $lt: MAX_ATTEMPTS },
      nextAttemptAt: { $lte: now },
      $or: [
        { leaseUntil: { $exists: false } },
        { leaseUntil: null },
        { leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "processing",
        leaseUntil: new Date(now.getTime() + LEASE_MS),
      },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { nextAttemptAt: 1, _id: 1 } },
  );
}

/**
 * The whole retry policy, in one place and exported for tests.
 *
 * An unrecognised error stays retryable: mistaking an unknown fault for a
 * permanent one strands an order the carrier would have accepted.
 *
 * `authFailure` is reported rather than acted on here, so this stays a pure
 * function of the error — the caller is what turns it into a flag on the
 * carrier, because a dead credential is a fact about the account, not about
 * this one job.
 */
export function classifyShipmentFailure(
  provider: CarrierProvider | undefined,
  error: unknown,
  attempts: number,
) {
  const message =
    error instanceof Error ? error.message.slice(0, 2000) : "Unknown error";

  const failure =
    error instanceof CarrierError
      ? error.toFailure()
      : provider
        ? carrierAdapter(provider).classify(error)
        : undefined;

  if (!failure) {
    return {
      message,
      errorCode: undefined as string | undefined,
      authFailure: false,
      nextAttemptAt:
        attempts >= MAX_ATTEMPTS ? DEAD_LETTER_AT : retryAt(attempts),
    };
  }

  if (failure.permanent) {
    // A bad address or a missing pickup location will not become valid by
    // waiting, and every extra attempt delays telling the merchant.
    return {
      message,
      errorCode: failure.errorCode,
      authFailure: failure.authFailure,
      nextAttemptAt: DEAD_LETTER_AT,
    };
  }

  return {
    message,
    errorCode: failure.errorCode,
    authFailure: failure.authFailure,
    nextAttemptAt:
      attempts >= MAX_ATTEMPTS
        ? DEAD_LETTER_AT
        : retryAt(attempts, failure.retryAfterSeconds || 0),
  };
}

/**
 * Which carrier a job actually talked to.
 *
 * `job.provider` is only knowable at enqueue time, and an `auto_ship` job has
 * none: the provider is chosen inside the run, from the store's settings and
 * the lane. So the health flag — the one thing that tells a merchant their
 * token is dead — was gated on a field that is undefined on precisely the path
 * that runs unattended, and a revoked token dead-lettered every automated
 * shipment in total silence.
 *
 * Two fallbacks, because the two directions fail differently. A run that got
 * far enough reports what it used. A run that died *before* that — which is
 * what an auth failure is, since it happens on the first call — leaves only the
 * error, and a `CarrierError` carries its own provider.
 *
 * Exported for tests: the gap this closes is invisible in every normal run and
 * only shows up as a missing warning on the day a token is revoked.
 */
export function providerForJob(
  job: IShipmentJob,
  from: { result?: unknown; error?: unknown },
): CarrierProvider | undefined {
  if (job.provider) return job.provider;
  const reported = (from.result as { provider?: CarrierProvider } | undefined)
    ?.provider;
  if (reported) return reported;
  return from.error instanceof CarrierError ? from.error.provider : undefined;
}

type LoadedContext = {
  order: IOrder;
  subOrder: SubOrder;
  customerEmail?: string;
};

async function loadJobContext(
  job: IShipmentJob,
): Promise<LoadedContext | null> {
  const order = await Order.findById(job.orderId)
    .populate("customerId", "email")
    .lean<
      (IOrder & { customerId?: { email?: string } | Types.ObjectId }) | null
    >();
  if (!order) return null;

  const subOrder = job.subOrderId
    ? order.subOrders?.find(
        (entry) => String(entry._id) === String(job.subOrderId),
      )
    : order.subOrders?.[0];
  if (!subOrder) return null;

  const customer = order.customerId as { email?: string } | undefined;
  return { order, subOrder, customerEmail: customer?.email };
}

async function runAutoShip(job: IShipmentJob) {
  const settings = await getSettings();
  const context = await loadJobContext(job);
  if (!context) {
    throw new CarrierError({
      code: "ORDER_MISSING",
      message: "The order or sub-order no longer exists",
      permanent: true,
    });
  }

  const existing = await Shipment.findOne({
    orderId: context.order._id,
    subOrderId: context.subOrder._id,
  })
    .sort({ createdAt: -1 })
    .lean();

  // Re-checked at execution time, not just at enqueue: an order can be
  // cancelled, refunded or shipped by hand between the two.
  const decision = isAutoShipEligible({
    order: context.order,
    subOrder: context.subOrder,
    automation: settings.shipping?.automation,
    carriersEnabled: Boolean(settings.shipping?.carriers?.enabled),
    existingShipment: existing,
  });
  if (!decision.eligible) {
    return { skipped: decision.reason };
  }

  const automation = settings.shipping!.automation!;

  const rateResult = await rateShopSubOrder({
    order: context.order,
    subOrder: context.subOrder,
    actorId: job.requestedBy || "system",
    customerEmail: context.customerEmail,
    provider: automation.fixedProvider,
    settings,
  });

  // Whatever `pickProvider` settled on. Reported back so a successful run can
  // clear a standing auth alarm for the right carrier — the job row itself
  // never knew which one this would be.
  const provider = rateResult.shipment.provider;

  if (!automation.buyLabel) {
    // "Draft only": the merchant wants the rates ready but the decision theirs.
    return {
      shipmentId: String(rateResult.shipment._id),
      draftOnly: true,
      provider,
    };
  }

  const quote = selectQuote(rateResult.quotes, automation);
  if (!quote) {
    throw new CarrierError({
      code: "NO_MATCHING_RATE",
      message:
        automation.rateChoice === "fixed_service"
          ? "The configured shipping service was not offered for this shipment"
          : "No carrier rate was available",
      permanent: true,
    });
  }

  // A guard the merchant set precisely so automation cannot spend without
  // limit; over it, the draft waits for a human.
  if (
    typeof automation.maxLabelCost === "number" &&
    automation.maxLabelCost > 0 &&
    quote.amount > automation.maxLabelCost
  ) {
    return {
      shipmentId: String(rateResult.shipment._id),
      skipped: "above_max_label_cost" as const,
      provider,
    };
  }

  const { shipment } = await purchaseShipmentLabel({
    shipmentId: String(rateResult.shipment._id),
    order: context.order,
    subOrder: context.subOrder,
    rateId: quote.rateId,
    serviceToken: quote.serviceToken,
    actorId: job.requestedBy || "system",
    customerEmail: context.customerEmail,
    settings,
    // "Cheapest" and "fastest" are rules, so re-applying them to a refreshed
    // rate list is exactly what the merchant configured. A named service is a
    // choice, and the settings screen already promises it will not be
    // substituted — the shipment waits instead.
    rateSelection:
      automation.rateChoice === "fixed_service" ? "exact" : "policy",
    // Carried through because the check above is against the quote chosen here,
    // and a stale rate list makes the one redeemed a different quote.
    maxAmount: automation.maxLabelCost,
  });

  if (automation.markOrderShipped && shipment.trackingNumber) {
    await applyShipmentTrackingToOrder({
      orderId: String(context.order._id),
      subOrderId: context.subOrder._id
        ? String(context.subOrder._id)
        : undefined,
      trackingNumber: shipment.trackingNumber,
      carrier: shipment.rate?.carrierName || shipment.carrier,
      targetStatus: ORDER_STATUS.SHIPPED,
    });
  }

  return { shipmentId: String(shipment._id), provider };
}

async function runPurchaseLabel(job: IShipmentJob) {
  const context = await loadJobContext(job);
  if (!context || !job.shipmentId) {
    throw new CarrierError({
      code: "ORDER_MISSING",
      message: "The order or shipment no longer exists",
      permanent: true,
    });
  }
  const { shipment } = await purchaseShipmentLabel({
    shipmentId: String(job.shipmentId),
    order: context.order,
    subOrder: context.subOrder,
    rateId: job.payload?.rateId,
    serviceToken: job.payload?.serviceToken,
    actorId: job.requestedBy || "system",
    customerEmail: context.customerEmail,
  });
  return { shipmentId: String(shipment._id), provider: shipment.provider };
}

async function runSyncTracking(job: IShipmentJob) {
  if (!job.shipmentId) {
    throw new CarrierError({
      code: "SHIPMENT_MISSING",
      message: "This job has no shipment to track",
      permanent: true,
    });
  }
  // `refreshShipmentTracking` cascades the movement to the order itself, so the
  // queue and the manual refresh button cannot disagree about what a delivery
  // scan means.
  const result = await refreshShipmentTracking({
    shipmentId: String(job.shipmentId),
  });

  return {
    status: result.shipment.status,
    provider: result.shipment.provider,
  };
}

async function runVoidLabel(job: IShipmentJob) {
  if (!job.shipmentId) {
    throw new CarrierError({
      code: "SHIPMENT_MISSING",
      message: "This job has no shipment to void",
      permanent: true,
    });
  }
  const result = await voidShipmentLabel({
    shipmentId: String(job.shipmentId),
  });
  return { refunded: result.refunded, provider: result.shipment.provider };
}

async function processShipmentJob(job: IShipmentJob) {
  try {
    let result: unknown;
    switch (job.kind) {
      case "auto_ship":
        result = await runAutoShip(job);
        break;
      case "purchase_label":
        result = await runPurchaseLabel(job);
        break;
      case "sync_tracking":
        result = await runSyncTracking(job);
        break;
      case "void_label":
        result = await runVoidLabel(job);
        break;
    }

    await ShipmentJob.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "done",
          leaseUntil: null,
          lastError: null,
          lastErrorCode: null,
          deadLetteredAt: null,
          expiresAt: retentionDate(DONE_RETENTION_MS),
        },
      },
    );
    // The carrier just accepted our credentials, so any standing alarm about
    // them is stale. Clearing it here means replacing a dead token heals the
    // banner by itself, without the merchant having to find Test connection.
    const succeededOn = providerForJob(job, { result });
    if (succeededOn) await clearCarrierAuthFailure(succeededOn);
    return { ok: true as const, result };
  } catch (error) {
    const provider = providerForJob(job, { error });
    const verdict = classifyShipmentFailure(provider, error, job.attempts);
    const deadLettered = verdict.nextAttemptAt === DEAD_LETTER_AT;

    // The one failure that says nothing about this job and everything about the
    // account. Every parcel on this carrier is about to dead-letter the same
    // way, so it is recorded where an operator will actually see it rather than
    // only on the job row.
    if (verdict.authFailure && provider) {
      await flagCarrierAuthFailure(provider, verdict.message);
    }

    await ShipmentJob.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "failed",
          leaseUntil: null,
          nextAttemptAt: verdict.nextAttemptAt,
          lastError: verdict.message,
          lastErrorCode: verdict.errorCode ?? null,
          // Stamped only when the retries are genuinely over, so a recurring
          // job can tell how long it has been dead before asking once more.
          deadLetteredAt: deadLettered ? new Date() : null,
          // Only a terminal row gets a TTL; one still due for retry must not
          // be reaped out from under the queue.
          expiresAt: deadLettered ? retentionDate(FAILED_RETENTION_MS) : null,
        },
      },
    );
    return { ok: false as const, error: verdict.message };
  }
}

/**
 * Queue auto-shipping for every eligible sub-order of one order, then drain
 * immediately.
 *
 * Called from the order PUT routes so an interactive merchant sees the label
 * in seconds. Correctness still lives in the queue — this is only latency.
 */
export async function queueAutoShipForOrder(
  orderId: string,
  requestedBy?: string,
) {
  const settings = await getSettings();
  if (
    !settings.shipping?.carriers?.enabled ||
    !settings.shipping?.automation?.enabled
  ) {
    return { queued: 0 };
  }

  const order = await Order.findById(orderId).lean<IOrder | null>();
  if (!order) return { queued: 0 };

  let queued = 0;
  for (const subOrder of order.subOrders || []) {
    const existing = await Shipment.findOne({
      orderId: order._id,
      subOrderId: subOrder._id,
    })
      .sort({ createdAt: -1 })
      .lean();

    const decision = isAutoShipEligible({
      order,
      subOrder,
      automation: settings.shipping?.automation,
      carriersEnabled: true,
      existingShipment: existing,
    });
    if (!decision.eligible) continue;

    await enqueueShipmentJob({
      orderId: order._id,
      subOrderId: subOrder._id,
      vendorId: subOrder.vendorId,
      kind: "auto_ship",
      requestedBy,
    });
    queued += 1;
  }

  if (queued > 0) await processShipmentJobs(queued);
  return { queued };
}

export async function processShipmentJobs(limit = 10) {
  const startedAt = Date.now();
  let processed = 0;
  let failed = 0;

  for (let index = 0; index < limit; index += 1) {
    if (Date.now() - startedAt > BATCH_BUDGET_MS) break;
    const job = await claimShipmentJob();
    if (!job) break;

    const outcome = await processShipmentJob(job);
    processed += 1;
    if (!outcome.ok) failed += 1;
  }

  return { processed, failed };
}

/**
 * How stale a parcel's tracking may get before it is polled again.
 *
 * Widens with age deliberately: a parcel posted this morning changes state
 * several times a day, one from last week changes rarely, and polling both at
 * the same cadence would spend the carrier's rate limit on the ones least
 * likely to have moved. Webhooks remain the primary path — this exists because
 * Shippo retries a failed delivery only twice.
 */
function trackingPollIntervalMs(createdAt: Date): number {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (ageMs < 2 * day) return 2 * 60 * 60 * 1000;
  if (ageMs < 7 * day) return 6 * 60 * 60 * 1000;
  return day;
}

/** Queue a tracking refresh for every parcel that is due one. */
export async function sweepTrackingCandidates(limit = 200) {
  const settings = await getSettings();
  if (!settings.shipping?.carriers?.enabled) return { scanned: 0, queued: 0 };

  const now = Date.now();
  const candidates = await Shipment.find({
    provider: { $exists: true },
    status: { $in: ["label_ready", "shipped", "in_transit"] },
    // A parcel still moving after 45 days is a lost cause, not a poll target.
    createdAt: { $gte: new Date(now - 45 * 24 * 60 * 60 * 1000) },
    trackingNumber: { $type: "string" },
  })
    .select("_id orderId subOrderId vendorId provider createdAt lastSyncedAt")
    .sort({ lastSyncedAt: 1 })
    .limit(limit)
    .lean();

  let queued = 0;
  for (const shipment of candidates) {
    const interval = trackingPollIntervalMs(shipment.createdAt);
    const lastSynced = shipment.lastSyncedAt
      ? new Date(shipment.lastSyncedAt).getTime()
      : 0;
    if (now - lastSynced < interval) continue;

    await enqueueShipmentJob({
      orderId: shipment.orderId,
      subOrderId: shipment.subOrderId,
      vendorId: shipment.vendorId,
      shipmentId: shipment._id,
      kind: "sync_tracking",
      provider: shipment.provider,
    });
    queued += 1;
  }

  return { scanned: candidates.length, queued };
}

/**
 * Find orders that should have auto-shipped and queue them.
 *
 * Mandatory, not belt-and-braces: all six payment finalizers write
 * `PROCESSING` directly (`lib/stripe-orders.ts`, `paystack-orders.ts`,
 * `pesapal-orders.ts`, `razorpay-orders.ts`, `iotec-orders.ts`, plus the PayPal
 * capture and preorder-release routes). Hooking eight sites is eight chances to
 * miss one, and several sit inside gateway webhooks whose latency budget
 * belongs to the gateway.
 */
export async function sweepAutoShipCandidates(limit = 200) {
  const settings = await getSettings();
  if (
    !settings.shipping?.carriers?.enabled ||
    !settings.shipping?.automation?.enabled
  ) {
    return { scanned: 0, queued: 0 };
  }

  const now = Date.now();
  const orders = await Order.find({
    status: ORDER_STATUS.PROCESSING,
    "subOrders.status": ORDER_STATUS.PROCESSING,
    // An order nobody shipped in a week is not going to start now, and the
    // bound is what keeps this an index scan rather than a growing table walk.
    createdAt: { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) },
    $or: [
      { autoShipCheckedAt: { $exists: false } },
      { autoShipCheckedAt: { $lt: new Date(now - 5 * 60 * 1000) } },
    ],
  })
    .limit(limit)
    .lean<IOrder[]>();

  let queued = 0;

  for (const order of orders) {
    for (const subOrder of order.subOrders || []) {
      const existing = await Shipment.findOne({
        orderId: order._id,
        subOrderId: subOrder._id,
      })
        .sort({ createdAt: -1 })
        .lean();

      const decision = isAutoShipEligible({
        order,
        subOrder,
        automation: settings.shipping?.automation,
        carriersEnabled: true,
        existingShipment: existing,
      });
      if (!decision.eligible) continue;

      await enqueueShipmentJob({
        orderId: order._id,
        subOrderId: subOrder._id,
        vendorId: subOrder.vendorId,
        kind: "auto_ship",
      });
      queued += 1;
    }

    // Stamped whatever the outcome, so the sweep never re-examines the same
    // order forever and stays a bounded index scan.
    await Order.updateOne(
      { _id: order._id },
      { $set: { autoShipCheckedAt: new Date() } },
    );
  }

  return { scanned: orders.length, queued };
}
