import "server-only";

import { randomUUID } from "node:crypto";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import {
  checkItemsBatch,
  sendItemsBatch,
  type BatchStatusAnswer,
  type ItemsBatchRequest,
} from "@/lib/meta-catalog/catalog-api";
import { classifyCatalogError, type CatalogFailure } from "@/lib/meta-catalog/catalog-errors";
import {
  createMetaBatchMapper,
  loadMetaFeedSetup,
  META_PRODUCT_SELECT,
  type MetaFeedSetup,
} from "@/lib/meta-catalog/feed-source";
import {
  pauseMetaLiveSync,
  readMetaLiveCredentials,
  readMetaLiveState,
  recordMetaRunError,
  recordMetaSyncSuccess,
  recordMetaThrottle,
  type MetaLiveState,
} from "@/lib/meta-catalog/live-state";
import type { MetaCatalogProductSource } from "@/lib/meta-catalog/map-product";
import { continueMetaCatalogReconcile, type ReconcileOutcome } from "@/lib/meta-catalog/reconcile";
import { notifyAdminsMetaCatalogPaused } from "@/lib/meta-catalog/sync-alerts";
import { packCalls, planProductSync, type SentItem } from "@/lib/meta-catalog/sync-batch";
import { watchMetaCatalogInputs, type WatchOutcome } from "@/lib/meta-catalog/sync-watcher";
import { Product } from "@/models";
import { MetaCatalogBatch } from "@/models/meta-catalog-batch.model";
import { MetaCatalogSync } from "@/models/meta-catalog-sync.model";

/**
 * The live sync's worker: what changed goes to Meta's Catalog Batch API.
 *
 * Each run, in order, while its time budget lasts:
 * 1. the watcher marks what changed without a product write (./sync-watcher.ts);
 * 2. batch calls Meta is still ingesting are checked, and the items it
 *    refused are recorded on their products;
 * 3. due products are claimed under a lease, mapped exactly as the feed maps
 *    them, compared with what Meta was last sent (./sync-batch.ts), and their
 *    UPDATEs and DELETEs sent in calls of up to 3,000 requests;
 * 4. the hourly reconcile moves on (./reconcile.ts).
 *
 * Run every minute by /api/cron/meta-catalog, and straight after "Sync
 * everything now" or a working "Test connection". Two runs at once are safe:
 * a product is held by one run's lease, the reconcile by its own.
 *
 * Failures (./catalog-errors.ts): throttling stops the run and holds every
 * call back for the delay Meta asked for, with nothing lost and no product's
 * tries counted; a dead token or missing permission pauses the sync and tells
 * the admins once; anything else is retried per product on a growing delay
 * of up to an hour — never given up on.
 */

export const RUN_BUDGET_MS = 45_000;
/** Longer than a claimed round can take, so a live run keeps its products. */
const LEASE_MS = 3 * 60_000;
const CLAIM_SIZE = 250;
/** A call may take 25 s; none starts with less than this left of the budget. */
const CALL_MIN_REMAINING_MS = 15_000;
const RECONCILE_MIN_REMAINING_MS = 10_000;
const CHECKS_PER_RUN = 10;
/** When a handle is checked again: 30 s after the call, then wider apart. */
const CHECK_DELAYS_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000];
const CHECK_GIVE_UP_MS = 24 * 60 * 60_000;
const BATCH_RETENTION_MS = 7 * 24 * 60 * 60_000;
const CHECK_LEASE_MS = 60_000;

export function productRetryDelayMs(attempts: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

export function throttleDelayMs(count: number, retryAfterSeconds?: number): number {
  const ladder = Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, count - 1));
  return Math.max(ladder, (retryAfterSeconds ?? 0) * 1000);
}

type ItemErrorRow = { itemId: string; message: string; at: Date };

type ClaimedRow = {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  items?: SentItem[];
  itemErrors?: ItemErrorRow[];
  attempts?: number;
  claimId: string;
};

export type MetaSyncRunSummary = {
  skipped?: "off" | "paused" | "throttled" | "config";
  watch?: WatchOutcome;
  checked: number;
  claimed: number;
  calls: number;
  updates: number;
  deletes: number;
  rejected: number;
  stoppedBy?: CatalogFailure["kind"];
  budgetExhausted?: boolean;
  reconcile?: ReconcileOutcome;
};

function emptySummary(): MetaSyncRunSummary {
  return { checked: 0, claimed: 0, calls: 0, updates: 0, deletes: 0, rejected: 0 };
}

/* ------------------------------------------------------------------------ */
/* Claiming and settling product rows                                       */
/* ------------------------------------------------------------------------ */

function claimableFilter(now: Date) {
  return {
    $and: [
      {
        $or: [
          { dirty: true, nextAttemptAt: { $lte: now } },
          // A run that died holding the row: its lease ran out.
          { leaseUntil: { $lte: now } },
        ],
      },
      {
        $or: [
          { leaseUntil: { $exists: false } },
          { leaseUntil: null },
          { leaseUntil: { $lte: now } },
        ],
      },
    ],
  };
}

async function claimDueRows(limit: number): Promise<ClaimedRow[]> {
  const now = new Date();
  const filter = claimableFilter(now);
  const candidates = await MetaCatalogSync.find(filter)
    .sort({ nextAttemptAt: 1, _id: 1 })
    .limit(limit)
    .select("_id")
    .lean<Array<{ _id: Types.ObjectId }>>();
  if (candidates.length === 0) return [];
  const claimId = randomUUID();
  // The filter again: a row another run took in between stays its.
  await MetaCatalogSync.updateMany(
    { _id: { $in: candidates.map((row) => row._id) }, ...filter },
    {
      // Cleared at the claim: a mark that lands while the row is out sets it
      // again, and the row goes round once more.
      $set: { dirty: false, leaseUntil: new Date(now.getTime() + LEASE_MS), claimId, lastAttemptAt: now },
    },
  );
  return MetaCatalogSync.find({ claimId })
    .select("productId items itemErrors attempts claimId")
    .lean<ClaimedRow[]>();
}

/** Back in the queue untouched (throttled, paused, out of time): no try is counted. */
async function releaseRows(rows: ClaimedRow[], nextAttemptAt: Date): Promise<void> {
  if (rows.length === 0) return;
  await MetaCatalogSync.collection.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: { _id: row._id, claimId: row.claimId },
        update: { $set: { dirty: true, nextAttemptAt }, $unset: { leaseUntil: "", claimId: "" } },
      },
    })),
    { ordered: false },
  );
}

/** Meta refused the call these products were in: try again later, later each time. */
async function failRows(rows: ClaimedRow[], message: string): Promise<void> {
  if (rows.length === 0) return;
  const now = Date.now();
  await MetaCatalogSync.collection.bulkWrite(
    rows.map((row) => {
      const attempts = (row.attempts ?? 0) + 1;
      return {
        updateOne: {
          filter: { _id: row._id, claimId: row.claimId },
          update: {
            $set: {
              dirty: true,
              attempts,
              nextAttemptAt: new Date(now + productRetryDelayMs(attempts)),
              lastError: message.slice(0, 1000),
            },
            $unset: { leaseUntil: "", claimId: "" },
          },
        },
      };
    }),
    { ordered: false },
  );
}

/**
 * The product's record after a send Meta took: what it now holds, and the
 * items it refused on arrival. A refusal of an item that was not re-sent
 * stands until that item is sent again; one for an item that went away goes
 * with it.
 */
function settledErrors(
  previous: ItemErrorRow[],
  next: SentItem[],
  resent: Set<string>,
  refused: Map<string, string>,
  now: Date,
): ItemErrorRow[] {
  const nextIds = new Set(next.map((item) => item.id));
  const kept = previous.filter(
    (entry) => nextIds.has(entry.itemId) && !resent.has(entry.itemId),
  );
  for (const [itemId, message] of refused) kept.push({ itemId, message, at: now });
  return kept;
}

async function settleRow(
  row: ClaimedRow,
  next: SentItem[],
  options: { productGone: boolean; resent: Set<string>; refused: Map<string, string>; sent: boolean },
): Promise<void> {
  const now = new Date();
  if (options.productGone && next.length === 0) {
    // Nothing left at Meta for a product that no longer exists. Kept if a
    // mark came in meanwhile (`dirty`), for that run to settle.
    const removed = await MetaCatalogSync.deleteOne({
      _id: row._id,
      claimId: row.claimId,
      dirty: false,
    });
    if (removed.deletedCount === 1) return;
  }
  const itemErrors = settledErrors(row.itemErrors ?? [], next, options.resent, options.refused, now);
  await MetaCatalogSync.updateOne(
    { _id: row._id, claimId: row.claimId },
    {
      $set: {
        items: next,
        attempts: 0,
        itemErrors,
        errorCount: itemErrors.length,
        ...(options.refused.size > 0 ? { lastErrorAt: now } : {}),
        ...(options.sent ? { lastSentAt: now } : {}),
      },
      $unset: { leaseUntil: "", claimId: "", lastError: "" },
    },
  );
}

/* ------------------------------------------------------------------------ */
/* Failures                                                                 */
/* ------------------------------------------------------------------------ */

/** True when the run has to stop. */
async function stopFor(failure: CatalogFailure, state: MetaLiveState): Promise<boolean> {
  if (failure.kind === "throttle") {
    const count = state.throttleCount + 1;
    await recordMetaThrottle(
      new Date(Date.now() + throttleDelayMs(count, failure.retryAfterSeconds)),
      count,
    );
    state.throttleCount = count;
    return true;
  }
  if (failure.kind === "auth") {
    const code = failure.pauseCode ?? "token";
    if (await pauseMetaLiveSync({ code, reason: failure.message })) {
      await notifyAdminsMetaCatalogPaused({ code, reason: failure.message });
    }
    return true;
  }
  if (failure.kind === "config") {
    await recordMetaRunError(failure.message);
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------------ */
/* Batch status checks                                                      */
/* ------------------------------------------------------------------------ */

type BatchDoc = {
  _id: Types.ObjectId;
  handle: string;
  catalogId: string;
  sentAt: Date;
  checks: number;
  items: Array<{ id: string; productId: Types.ObjectId; method: "UPDATE" | "DELETE" }>;
};

async function claimDueBatch(): Promise<BatchDoc | null> {
  const now = new Date();
  return MetaCatalogBatch.findOneAndUpdate(
    {
      nextCheckAt: { $lte: now },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lte: now } }],
    },
    { $set: { leaseUntil: new Date(now.getTime() + CHECK_LEASE_MS) }, $inc: { checks: 1 } },
    { sort: { nextCheckAt: 1 }, returnDocument: "after" },
  ).lean<BatchDoc | null>();
}

/**
 * What Meta's background ingest said, onto the products: the items it did not
 * save get its reason; items it saved lose a refusal recorded before this
 * call. A batch Meta abandoned is sent again.
 */
async function applyBatchStatus(batch: BatchDoc, status: BatchStatusAnswer): Promise<number> {
  const updates = batch.items.filter((item) => item.method === "UPDATE");
  const byProduct = new Map<string, typeof updates>();
  for (const item of updates) {
    const key = String(item.productId);
    byProduct.set(key, [...(byProduct.get(key) ?? []), item]);
  }

  if (status.state === "failed") {
    for (const items of byProduct.values()) {
      await MetaCatalogSync.updateOne(
        { productId: items[0].productId },
        {
          $set: {
            "items.$[item].hash": "",
            dirty: true,
            nextAttemptAt: new Date(Date.now() + 60_000),
          },
        },
        { arrayFilters: [{ "item.id": { $in: items.map((item) => item.id) } }] },
      );
    }
    return 0;
  }

  const invalid = new Set(status.invalidIds);
  const reasons = new Map(
    status.errors.filter((entry) => entry.id).map((entry) => [entry.id!, entry.message]),
  );
  let refused = 0;
  const now = new Date();
  for (const items of byProduct.values()) {
    const row = await MetaCatalogSync.findOne({ productId: items[0].productId })
      .select("itemErrors items updatedAt")
      .lean<{ _id: Types.ObjectId; itemErrors?: ItemErrorRow[]; items?: SentItem[]; updatedAt: Date }>();
    if (!row) continue;
    const held = new Set((row.items ?? []).map((item) => item.id));
    const ids = new Set(items.map((item) => item.id));
    const bad = items.filter((item) => invalid.has(item.id) && held.has(item.id));
    // Refusals newer than this call stand; this call's answer replaces the rest.
    const kept = (row.itemErrors ?? []).filter(
      (entry) => !ids.has(entry.itemId) || new Date(entry.at) > batch.sentAt,
    );
    const itemErrors = [
      ...kept.filter((entry) => !bad.some((item) => item.id === entry.itemId)),
      ...bad.map((item) => ({ itemId: item.id, message: reasons.get(item.id) ?? "", at: now })),
    ];
    refused += bad.length;
    await MetaCatalogSync.updateOne(
      { _id: row._id },
      {
        $set: {
          itemErrors,
          errorCount: itemErrors.length,
          ...(bad.length > 0 ? { lastErrorAt: now } : {}),
        },
      },
    );
  }
  return refused;
}

async function checkDueBatches(
  credentials: { catalogId: string; token: string },
  state: MetaLiveState,
  deadline: number,
  summary: MetaSyncRunSummary,
): Promise<boolean> {
  for (let index = 0; index < CHECKS_PER_RUN && Date.now() < deadline - CALL_MIN_REMAINING_MS; index += 1) {
    const batch = await claimDueBatch();
    if (!batch) return false;
    summary.checked += 1;
    if (batch.catalogId !== credentials.catalogId) {
      await MetaCatalogBatch.deleteOne({ _id: batch._id });
      continue;
    }
    let status: BatchStatusAnswer;
    try {
      status = await checkItemsBatch(credentials.catalogId, credentials.token, batch.handle);
    } catch (error) {
      const failure = classifyCatalogError(error);
      const delay = CHECK_DELAYS_MS[Math.min(batch.checks, CHECK_DELAYS_MS.length - 1)];
      await MetaCatalogBatch.updateOne(
        { _id: batch._id },
        { $set: { nextCheckAt: new Date(Date.now() + delay) }, $unset: { leaseUntil: "" } },
      );
      if (await stopFor(failure, state)) {
        summary.stoppedBy = failure.kind;
        return true;
      }
      continue;
    }
    if (status.state === "pending") {
      if (Date.now() - new Date(batch.sentAt).getTime() > CHECK_GIVE_UP_MS) {
        await MetaCatalogBatch.deleteOne({ _id: batch._id });
        continue;
      }
      const delay = CHECK_DELAYS_MS[Math.min(batch.checks, CHECK_DELAYS_MS.length - 1)];
      await MetaCatalogBatch.updateOne(
        { _id: batch._id },
        { $set: { nextCheckAt: new Date(Date.now() + delay) }, $unset: { leaseUntil: "" } },
      );
      continue;
    }
    summary.rejected += await applyBatchStatus(batch, status);
    await MetaCatalogBatch.deleteOne({ _id: batch._id });
  }
  return false;
}

/* ------------------------------------------------------------------------ */
/* Sending                                                                  */
/* ------------------------------------------------------------------------ */

type Plan = {
  row: ClaimedRow;
  productGone: boolean;
  requests: ItemsBatchRequest[];
  next: SentItem[];
};

/** One claimed round: map, compare, send. True when the run has to stop. */
async function syncRound(
  rows: ClaimedRow[],
  context: {
    credentials: { catalogId: string; token: string };
    state: MetaLiveState;
    mapBatch: ReturnType<typeof createMetaBatchMapper>;
    deadline: number;
    summary: MetaSyncRunSummary;
  },
): Promise<boolean> {
  const { credentials, state, mapBatch, deadline, summary } = context;
  const products = await Product.find({ _id: { $in: rows.map((row) => row.productId) } })
    .select(META_PRODUCT_SELECT)
    .lean<Array<MetaCatalogProductSource & { _id: Types.ObjectId }>>();
  const mapped = new Map(
    (await mapBatch(products)).map(({ product, result }) => [String(product._id), result.items]),
  );

  const plans: Plan[] = rows.map((row) => {
    const key = String(row.productId);
    const plan = planProductSync(row.items ?? [], mapped.get(key) ?? []);
    return { row, productGone: !products.some((p) => String(p._id) === key), ...plan };
  });

  // Nothing Meta needs: settled at once.
  for (const plan of plans.filter((entry) => entry.requests.length === 0)) {
    await settleRow(plan.row, plan.next, {
      productGone: plan.productGone,
      resent: new Set(),
      refused: new Map(),
      sent: false,
    });
  }

  const calls = packCalls(plans.filter((entry) => entry.requests.length > 0));
  // A plan split across calls settles only after its last one.
  const remaining = new Map<Plan, number>();
  for (const call of calls) {
    for (const part of call) remaining.set(part.plan, (remaining.get(part.plan) ?? 0) + 1);
  }
  const refusedByPlan = new Map<Plan, Map<string, string>>();
  const failed = new Set<Plan>();

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    const pending = () =>
      calls
        .slice(index)
        .flatMap((parts) => parts.map((part) => part.plan))
        .filter((plan, position, list) => list.indexOf(plan) === position && !failed.has(plan));

    if (deadline - Date.now() < CALL_MIN_REMAINING_MS) {
      await releaseRows(pending().map((plan) => plan.row), new Date());
      summary.budgetExhausted = true;
      return true;
    }

    const requests = call.flatMap((part) => part.requests);
    let answer;
    try {
      answer = await sendItemsBatch(credentials.catalogId, credentials.token, requests);
    } catch (error) {
      const failure = classifyCatalogError(error);
      if (await stopFor(failure, state)) {
        summary.stoppedBy = failure.kind;
        const until =
          failure.kind === "throttle" ? new Date(Date.now() + throttleDelayMs(state.throttleCount, failure.retryAfterSeconds)) : new Date();
        await releaseRows(pending().map((plan) => plan.row), until);
        return true;
      }
      const inCall = [...new Set(call.map((part) => part.plan))];
      for (const plan of inCall) failed.add(plan);
      await failRows(inCall.map((plan) => plan.row), failure.message);
      if (failure.kind === "transient") {
        // Meta is having trouble; the rest wait a minute rather than meet it too.
        summary.stoppedBy = "transient";
        await releaseRows(
          pending().filter((plan) => !inCall.includes(plan)).map((plan) => plan.row),
          new Date(Date.now() + 60_000),
        );
        return true;
      }
      continue;
    }

    summary.calls += 1;
    summary.updates += requests.filter((request) => request.method === "UPDATE").length;
    summary.deletes += requests.filter((request) => request.method === "DELETE").length;
    if (summary.calls === 1) await recordMetaSyncSuccess();

    const refusedIds = new Map(answer.rejected.map((entry) => [entry.id, entry.message]));
    summary.rejected += answer.rejected.length;
    const now = new Date();
    if (answer.handles.length > 0) {
      const items = call.flatMap((part) =>
        part.requests.map((request) => ({
          id: request.data.id,
          productId: part.plan.row.productId,
          method: request.method,
        })),
      );
      await MetaCatalogBatch.insertMany(
        answer.handles.map((handle) => ({
          handle,
          catalogId: credentials.catalogId,
          sentAt: now,
          nextCheckAt: new Date(now.getTime() + CHECK_DELAYS_MS[0]),
          checks: 0,
          items,
          expiresAt: new Date(now.getTime() + BATCH_RETENTION_MS),
        })),
        { ordered: false },
      ).catch((error) => console.error("Meta catalog: could not keep a batch handle", error));
    }

    for (const part of call) {
      const refused = refusedByPlan.get(part.plan) ?? new Map<string, string>();
      for (const request of part.requests) {
        const message = refusedIds.get(request.data.id);
        // A DELETE Meta could not apply has nothing left to delete.
        if (message !== undefined && request.method === "UPDATE") refused.set(request.data.id, message);
      }
      refusedByPlan.set(part.plan, refused);
      const left = (remaining.get(part.plan) ?? 1) - 1;
      remaining.set(part.plan, left);
      if (left > 0 || failed.has(part.plan)) continue;
      await settleRow(part.plan.row, part.plan.next, {
        productGone: part.plan.productGone,
        resent: new Set(
          part.plan.requests
            .filter((request) => request.method === "UPDATE")
            .map((request) => request.data.id),
        ),
        refused,
        sent: true,
      });
    }
  }
  return false;
}

/* ------------------------------------------------------------------------ */
/* The run                                                                  */
/* ------------------------------------------------------------------------ */

export async function runMetaCatalogSync(
  options: { budgetMs?: number } = {},
): Promise<MetaSyncRunSummary> {
  const deadline = Date.now() + (options.budgetMs ?? RUN_BUDGET_MS);
  const summary = emptySummary();
  await connectDB();

  const state = await readMetaLiveState();
  if (!state.active) return { ...summary, skipped: "off" };
  if (state.paused) return { ...summary, skipped: "paused" };
  if (state.throttledUntil && state.throttledUntil.getTime() > Date.now()) {
    return { ...summary, skipped: "throttled" };
  }

  let credentials: { catalogId: string; token: string };
  let setup: MetaFeedSetup;
  try {
    credentials = await readMetaLiveCredentials();
    setup = await loadMetaFeedSetup();
  } catch (error) {
    const failure = classifyCatalogError(error);
    if (await stopFor(failure, state)) return { ...summary, skipped: failure.kind === "auth" ? "paused" : "config" };
    throw error;
  }
  if (state.lastRunError) await recordMetaRunError(null);

  const imageToken = state.imageToken ?? "";
  summary.watch = await watchMetaCatalogInputs(setup, state.imageToken);

  if (await checkDueBatches(credentials, state, deadline, summary)) return summary;

  const mapBatch = createMetaBatchMapper({ token: imageToken, setup });
  while (deadline - Date.now() >= CALL_MIN_REMAINING_MS) {
    const rows = await claimDueRows(CLAIM_SIZE);
    if (rows.length === 0) break;
    summary.claimed += rows.length;
    const stop = await syncRound(rows, { credentials, state, mapBatch, deadline, summary });
    if (stop) return summary;
  }

  if (deadline - Date.now() >= RECONCILE_MIN_REMAINING_MS) {
    const live = await readMetaLiveState();
    summary.reconcile = await continueMetaCatalogReconcile({
      setup,
      imageToken,
      deadline: deadline - 2_000,
      live: {
        reconcile: live.reconcile ?? undefined,
        lastReconciledAt: live.lastReconciledAt ?? undefined,
      },
    });
  } else {
    summary.budgetExhausted = true;
  }
  return summary;
}
