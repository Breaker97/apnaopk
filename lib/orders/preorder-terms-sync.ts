import { Types } from "mongoose";
import { Order, Product } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import {
  PREORDER_ITEM_STATUS,
  PURCHASE_TYPE,
  getPreorderSettings,
  type PreorderSettingsShape,
} from "@/lib/orders/preorders";
import { isActiveCollection } from "@/lib/orders/preorder-scope";
import { runTransaction, getTransactionSupport } from "@/lib/db-transaction";

/**
 * Carrying a moved release date to every order waiting on the old one —
 * durably, in batches, under a lease, with nothing lost to a crash.
 *
 * The old propagation ran after the response, from process memory, over the
 * first 1,000 matching orders: a timeout, a restart or order number 1,001
 * meant shoppers kept a date the store had already withdrawn, and with
 * auto-release on they were asked for money — and charged — on it.
 *
 * Now a product save that moves a date writes, in the same update, a bumped
 * `preorderTermsRevision` and a pending `preorderDateSync` job on the product
 * (`lib/products/preorder-counters.ts`). This worker claims a job with an
 * expiring lease and a fence, walks the product's pre-order orders in `_id`
 * order 200 at a time, and persists its cursor after every batch. Each order
 * is reconciled with a guarded write ({@link reconcileOrderPreorderTerms}) that
 * moves only waiting lines, only later, never below a revision already
 * applied, and writes the shopper's delay notice into the same update as the
 * date — so a crash between the two still leaves the notice to send. A row
 * that fails is recorded on the job, which is not finished while any remain.
 * A second edit during a scan restarts it on the new revision; a worker that
 * lost its lease stops at its next write.
 *
 * Orders placed while a scan runs, on the old terms, are caught twice over:
 * new orders reconcile themselves when their reservation is recorded, and a
 * bounded catch-up pass looks at recent orders nothing has checked.
 */

const BATCH_SIZE = 200;
const LEASE_MS = 2 * 60 * 1000;
const MAX_RECORDED_FAILURES = 50;

const id = (value: unknown) =>
  String((value as { _id?: unknown } | null)?._id ?? value ?? "");

function time(value: unknown): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value as string | Date).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

function promisedDate(settings: PreorderSettingsShape | undefined): number | undefined {
  return settings?.enabled ? time(settings.releaseDate) : undefined;
}

type TermsProduct = Parameters<typeof getPreorderSettings>[0] & {
  _id: Types.ObjectId;
  name?: string;
  title?: string;
  preorderTermsRevision?: number;
};

type TermsLine = {
  productId?: unknown;
  variantId?: unknown;
  vendorId?: unknown;
  purchaseType?: string;
  preorderReleaseDate?: Date | null;
  preorderStatus?: string;
  preorderTermsRevision?: number | null;
};

type TermsOrder = {
  _id: Types.ObjectId;
  orderNumber: string;
  customerId?: unknown;
  guestEmail?: string;
  status?: string;
  preorderStatus?: string;
  preorderReleaseDate?: Date | null;
  preorderOriginalReleaseDate?: Date | null;
  preorderBalancePaidAt?: Date | null;
  preorderCollection?: { cycleId?: string; state?: string } | null;
  preorderRelease?: { state?: string; operationId?: string } | null;
  items?: TermsLine[];
  subOrders?: Array<{
    _id: Types.ObjectId;
    vendorId?: unknown;
    status?: string;
    preorderReadiness?: unknown;
    items?: TermsLine[];
  }>;
};

const ORDER_TERMS_FIELDS =
  "_id orderNumber customerId guestEmail status preorderStatus preorderReleaseDate preorderOriginalReleaseDate preorderBalancePaidAt preorderCollection preorderRelease items.productId items.variantId items.vendorId items.purchaseType items.preorderReleaseDate items.preorderStatus items.preorderTermsRevision subOrders._id subOrders.vendorId subOrders.status subOrders.preorderReadiness subOrders.items.productId subOrders.items.variantId subOrders.items.purchaseType subOrders.items.preorderReleaseDate subOrders.items.preorderStatus subOrders.items.preorderTermsRevision";

/**
 * The date a line should now carry, or undefined to leave it: only when the
 * product's current promise for the line is LATER than what the line holds,
 * and only when the line is behind the product's revision. Pure.
 */
export function laterLineDate(params: {
  product: TermsProduct;
  line: TermsLine;
}): Date | undefined {
  const variantId = params.line.variantId ? id(params.line.variantId) : undefined;
  const lineRevision = Number(params.line.preorderTermsRevision || 0);
  const productRevision = Number(params.product.preorderTermsRevision || 0);
  if (lineRevision >= productRevision) return undefined;
  const promised = promisedDate(getPreorderSettings(params.product, variantId));
  if (promised === undefined) return undefined;
  const held = time(params.line.preorderReleaseDate);
  // Never earlier: a line already promised a later date keeps it.
  if (held !== undefined && promised <= held) return undefined;
  return new Date(promised);
}

/** Kept for the old call sites' tests: the before/after form of the rule. */
export function pushedBackLineDate(params: {
  before: Parameters<typeof getPreorderSettings>[0];
  after: Parameters<typeof getPreorderSettings>[0];
  line: TermsLine;
}): Date | undefined {
  const variantId = params.line.variantId ? id(params.line.variantId) : undefined;
  const was = promisedDate(getPreorderSettings(params.before, variantId));
  const now = promisedDate(getPreorderSettings(params.after, variantId));
  if (now === undefined || was === now) return undefined;
  const held = time(params.line.preorderReleaseDate);
  if (held !== undefined && now <= held) return undefined;
  return new Date(now);
}

export type ReconcileTermsResult =
  | { status: "unchanged" }
  | { status: "stamped" }
  | { status: "moved"; orderDateMoved: boolean; reset: boolean }
  | { status: "skipped"; reason: string }
  | { status: "conflict" };

/**
 * Bring one order's waiting pre-order lines up to their products' current
 * terms. Moves a line only later, only while its consignment is still
 * waiting (a cancelled, released or shipped one keeps what it was told), and
 * stamps every reconciled line with the revision it now matches — so the same
 * order is never moved twice for one edit, and never back to an older one.
 *
 * A line that moves on an order whose balance has been prepared voids that
 * request and puts its stock back (`resetPreparedCollectionInSession`): the
 * notice and any scheduled charge described goods that are no longer coming
 * on that date. A paid order stays paid; nothing here asks for money.
 */
export async function reconcileOrderPreorderTerms(
  orderId: string,
  options: { now?: Date; productId?: string; attempts?: number } = {},
): Promise<ReconcileTermsResult> {
  const now = options.now || new Date();
  if (!Types.ObjectId.isValid(orderId)) return { status: "skipped", reason: "invalid_id" };
  for (let attempt = 0; attempt < (options.attempts ?? 3); attempt += 1) {
    const result = await reconcileOnce(orderId, now, options.productId);
    if (result.status !== "conflict") return result;
  }
  return { status: "conflict" };
}

async function reconcileOnce(
  orderId: string,
  now: Date,
  onlyProductId?: string,
): Promise<ReconcileTermsResult> {
  const order = (await Order.findById(orderId).select(ORDER_TERMS_FIELDS).lean()) as TermsOrder | null;
  if (!order) return { status: "skipped", reason: "order_missing" };
  if (order.status === ORDER_STATUS.CANCELLED) return { status: "skipped", reason: "cancelled" };

  const subs = order.subOrders || [];
  // An order whose lines cannot be read is a failure to record and retry,
  // never "nothing to change": silence here would leave it on old terms.
  if (
    !Array.isArray(subs) ||
    subs.some((sub) => sub.items != null && !Array.isArray(sub.items)) ||
    (order.items != null && !Array.isArray(order.items))
  ) {
    throw new Error("The order's pre-order lines could not be read");
  }
  const waitingSubIds = new Set(
    subs.filter((sub) => sub.status === ORDER_STATUS.PREORDERED).map((sub) => id(sub._id)),
  );
  const subOfVendor = new Map(subs.map((sub) => [id(sub.vendorId), sub]));
  const productIds = Array.from(
    new Set(
      subs
        .flatMap((sub) => sub.items || [])
        .filter((line) => line.purchaseType === PURCHASE_TYPE.PREORDER)
        .map((line) => id(line.productId))
        .filter((value) => !onlyProductId || value === onlyProductId),
    ),
  );
  if (productIds.length === 0) return { status: "unchanged" };
  const products = (await Product.find({ _id: { $in: productIds } })
    .select("_id name title preorder variants._id variants.preorder preorderTermsRevision")
    .lean()) as TermsProduct[];
  const productById = new Map(products.map((product) => [id(product._id), product]));

  const set: Record<string, unknown> = {};
  const filter: Record<string, unknown> = {
    _id: order._id,
    status: order.status,
    ...(order.preorderStatus ? { preorderStatus: order.preorderStatus } : {}),
  };
  const movedSubIds = new Set<string>();
  let stamped = false;
  let latestMoved = 0;
  const guardLine = (path: string, line: TermsLine, revision: number) => {
    filter[`${path}.productId`] = line.productId;
    filter[`${path}.purchaseType`] = PURCHASE_TYPE.PREORDER;
    filter[`${path}.preorderReleaseDate`] = line.preorderReleaseDate ?? null;
    filter[`${path}.preorderTermsRevision`] = { $not: { $gte: revision } };
  };

  // Consignment lines first: they decide; the top-level copy follows.
  const movedByVendorLine = new Map<string, { date?: Date; revision: number }[]>();
  subs.forEach((sub, subIndex) => {
    const waiting = waitingSubIds.has(id(sub._id));
    (sub.items || []).forEach((line, lineIndex) => {
      if (line.purchaseType !== PURCHASE_TYPE.PREORDER) return;
      const product = productById.get(id(line.productId));
      if (!product) return;
      const revision = Number(product.preorderTermsRevision || 0);
      if (Number(line.preorderTermsRevision || 0) >= revision) return;
      // A consignment that is no longer waiting keeps what it was told.
      if (!waiting) return;
      const path = `subOrders.${subIndex}.items.${lineIndex}`;
      guardLine(path, line, revision);
      filter[`subOrders.${subIndex}._id`] = sub._id;
      filter[`subOrders.${subIndex}.status`] = ORDER_STATUS.PREORDERED;
      const next = laterLineDate({ product, line });
      set[`${path}.preorderTermsRevision`] = revision;
      stamped = true;
      if (next) {
        set[`${path}.preorderReleaseDate`] = next;
        set[`${path}.preorderStatus`] = PREORDER_ITEM_STATUS.DELAYED;
        movedSubIds.add(id(sub._id));
        latestMoved = Math.max(latestMoved, next.getTime());
      }
      const key = `${id(sub.vendorId)}:${id(line.productId)}:${line.variantId ? id(line.variantId) : ""}`;
      const list = movedByVendorLine.get(key) || [];
      list.push({ date: next, revision });
      movedByVendorLine.set(key, list);
    });
  });
  if (!stamped) {
    return { status: "unchanged" };
  }

  // The top-level copy of each reconciled line, matched by seller, product
  // and variant in order of appearance.
  (order.items || []).forEach((line, index) => {
    if (line.purchaseType !== PURCHASE_TYPE.PREORDER) return;
    const key = `${id(line.vendorId)}:${id(line.productId)}:${line.variantId ? id(line.variantId) : ""}`;
    const queue = movedByVendorLine.get(key);
    if (!queue || queue.length === 0) return;
    const entry = queue.shift()!;
    const sub = subOfVendor.get(id(line.vendorId));
    if (!sub || !waitingSubIds.has(id(sub._id))) return;
    const path = `items.${index}`;
    guardLine(path, line, entry.revision);
    set[`${path}.preorderTermsRevision`] = entry.revision;
    if (entry.date) {
      set[`${path}.preorderReleaseDate`] = entry.date;
      set[`${path}.preorderStatus`] = PREORDER_ITEM_STATUS.DELAYED;
    }
  });

  // The order waits for its latest live line.
  const liveDates = subs
    .filter((sub) => waitingSubIds.has(id(sub._id)))
    .flatMap((sub) => sub.items || [])
    .filter((line) => line.purchaseType === PURCHASE_TYPE.PREORDER)
    .map((line) => time(line.preorderReleaseDate) ?? 0);
  const latestLive = Math.max(latestMoved, ...liveDates, 0);
  const previous = order.preorderReleaseDate || undefined;
  const orderDate = latestLive > 0 ? new Date(latestLive) : undefined;
  const orderDateMoved =
    movedSubIds.size > 0 &&
    orderDate !== undefined &&
    orderDate.getTime() > (time(previous) ?? 0);

  const unset: Record<string, ""> = {};
  const moved = movedSubIds.size > 0;
  if (moved) {
    // A waiting order whose goods moved later is delayed; one whose balance
    // was requested for goods now later is reset below and delayed too.
    const waitingStatuses: string[] = [
      PREORDER_ITEM_STATUS.RESERVED,
      PREORDER_ITEM_STATUS.DELAYED,
      PREORDER_ITEM_STATUS.PAYMENT_DUE,
      PREORDER_ITEM_STATUS.PARTIALLY_READY,
    ];
    if (waitingStatuses.includes(String(order.preorderStatus || ""))) {
      set.preorderStatus = PREORDER_ITEM_STATUS.DELAYED;
    }
    // Goods declared available for a consignment whose date just moved later
    // are not available after all.
    subs.forEach((sub, subIndex) => {
      if (movedSubIds.has(id(sub._id)) && sub.preorderReadiness) {
        unset[`subOrders.${subIndex}.preorderReadiness`] = "";
      }
    });
    // A paid order waiting on its release is waiting on goods that just
    // moved: its release request no longer stands.
    if (
      order.preorderRelease?.state === "requested" ||
      order.preorderRelease?.state === "waiting"
    ) {
      set["preorderRelease.state"] = "superseded";
      set["preorderRelease.reason"] = "date_changed";
    }
  }
  if (orderDateMoved && orderDate) {
    set.preorderReleaseDate = orderDate;
    set.preorderOriginalReleaseDate =
      order.preorderOriginalReleaseDate || previous || orderDate;
    set.preorderReleaseDateUpdatedAt = now;
    set.preorderCustomerNotifiedAt = now;
    unset.preorderBalanceRemindersSent = "";
    const productName = products.find((product) =>
      Array.from(movedByVendorLine.keys()).some((key) => key.split(":")[1] === id(product._id)),
    );
    set.preorderDateNotice = {
      state: "pending",
      key: `${products.map((product) => `${id(product._id)}@${product.preorderTermsRevision || 0}`).join(",")}`,
      previousReleaseDate: previous,
      releaseDate: orderDate,
      reason: productName?.name || productName?.title
        ? `The expected date for ${productName?.name || productName?.title} has moved.`
        : undefined,
      queuedAt: now,
    };
  }
  set.preorderTermsCheckedAt = now;

  const prepared = moved && isActiveCollection(order.preorderCollection);
  const update = {
    $set: set,
    ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
    $inc: moved && Object.keys(unset).some((key) => key.endsWith("preorderReadiness"))
      ? { preorderReadinessRevision: 1 }
      : {},
  };
  if ((update.$inc && Object.keys(update.$inc).length === 0)) delete (update as { $inc?: unknown }).$inc;

  if (prepared) {
    // Void the request and put its stock back in the same transaction as the
    // new date: no notice, scheduled charge or allocation may outlive the
    // promise they were made against.
    const support = await getTransactionSupport();
    if (!support.supported) return { status: "skipped", reason: "transactions_unavailable" };
    const { resetPreparedCollectionInSession } = await import("@/lib/orders/preorder-collection");
    const written = await runTransaction("Apply a moved pre-order date", async (session) => {
      const reset = await resetPreparedCollectionInSession({
        session,
        orderId,
        reason: "date_changed",
        now,
      });
      // The reset cleared readiness and bumped the revision itself.
      const ownUpdate = { ...update } as Record<string, unknown>;
      delete ownUpdate.$inc;
      const unsetCopy = { ...((ownUpdate.$unset as Record<string, "">) || {}) };
      for (const key of Object.keys(unsetCopy)) {
        if (key.endsWith("preorderReadiness")) delete unsetCopy[key];
      }
      if (Object.keys(unsetCopy).length > 0) ownUpdate.$unset = unsetCopy;
      else delete ownUpdate.$unset;
      const result = await Order.updateOne(
        { ...filter, preorderStatus: order.preorderStatus },
        ownUpdate,
        { session },
      );
      return { matched: result.matchedCount === 1, reset: reset.reset };
    }).catch(() => ({ matched: false, reset: false }));
    if (!written.matched) return { status: "conflict" };
    await sendPendingDateNotice(orderId).catch(() => undefined);
    return { status: "moved", orderDateMoved, reset: written.reset };
  }

  const written = await Order.updateOne(filter, update);
  if (written.matchedCount !== 1) return { status: "conflict" };
  if (!moved) return { status: "stamped" };
  await sendPendingDateNotice(orderId).catch((error) =>
    console.error("Failed to send a pre-order delay notice:", error),
  );
  return { status: "moved", orderDateMoved, reset: false };
}

/**
 * Send the delay notice an order is owed, once. The notifier's own dedupe
 * (status and the new date) makes a resend after a crash between sending and
 * marking a no-op for the shopper.
 */
export async function sendPendingDateNotice(orderId: string): Promise<boolean> {
  const order = (await Order.findOne({ _id: orderId, "preorderDateNotice.state": "pending" })
    .select("_id orderNumber customerId guestEmail status preorderDateNotice")
    .lean()) as (TermsOrder & {
      preorderDateNotice?: {
        key?: string;
        previousReleaseDate?: Date;
        releaseDate?: Date;
        reason?: string;
      };
    }) | null;
  if (!order?.preorderDateNotice) return false;
  const notice = order.preorderDateNotice;
  if (order.status !== ORDER_STATUS.CANCELLED && (order.customerId || order.guestEmail)) {
    const { notifyPreorderCustomerUpdate } = await import("@/lib/notifications/notifications");
    await notifyPreorderCustomerUpdate(
      String(order.customerId || ""),
      order.orderNumber,
      "delayed",
      String(order._id),
      {
        releaseDate: notice.releaseDate,
        previousReleaseDate: notice.previousReleaseDate,
        reason: notice.reason,
        guestEmail: order.guestEmail,
      },
    );
  }
  await Order.updateOne(
    { _id: order._id, "preorderDateNotice.state": "pending", "preorderDateNotice.key": notice.key },
    { $set: { "preorderDateNotice.state": "sent", "preorderDateNotice.sentAt": new Date() } },
  );
  return true;
}

/** Delay notices still owed — after a crash between the date and the send. */
export async function deliverPendingDateNotices(
  options: { limit?: number } = {},
): Promise<number> {
  const orders = await Order.find({ "preorderDateNotice.state": "pending" })
    .sort({ _id: 1 })
    .limit(Math.min(Math.max(options.limit ?? 200, 1), 1000))
    .select("_id")
    .lean<Array<{ _id: Types.ObjectId }>>();
  let sent = 0;
  for (const order of orders) {
    if (await sendPendingDateNotice(String(order._id)).catch(() => false)) sent += 1;
  }
  return sent;
}

// ---------------------------------------------------------------------------
// The job worker
// ---------------------------------------------------------------------------

export type DateSyncSummary = {
  jobs: number;
  completed: number;
  processed: number;
  moved: number;
  failed: number;
  /** A job that ran out of budget, or is waiting out a failure's backoff. */
  continuing: number;
};

type SyncJobProduct = TermsProduct & {
  preorderDateSync?: {
    state?: string;
    runRevision?: number;
    cursor?: Types.ObjectId;
    fence?: number;
    processed?: number;
    moved?: number;
    failures?: Array<{ orderId: Types.ObjectId; error?: string; attempts?: number }>;
  };
};

/**
 * Run pending date-propagation jobs within a time budget. A job not finished
 * in the budget keeps its cursor and continues on the next run; one with
 * unresolved failures stays open, retried with backoff.
 */
export async function runPreorderDateSyncJobs(
  options: {
    now?: Date;
    budgetMs?: number;
    batchSize?: number;
    owner?: string;
    maxJobs?: number;
    /** Stop after this many batches in all (what is left continues next run). */
    maxBatches?: number;
  } = {},
): Promise<DateSyncSummary> {
  const started = Date.now();
  const budgetMs = options.budgetMs ?? 25_000;
  const batchSize = Math.min(Math.max(options.batchSize ?? BATCH_SIZE, 1), 1000);
  const owner = options.owner || `sync_${new Types.ObjectId().toHexString()}`;
  const summary: DateSyncSummary = {
    jobs: 0,
    completed: 0,
    processed: 0,
    moved: 0,
    failed: 0,
    continuing: 0,
  };
  let batchesLeft = options.maxBatches ?? Number.POSITIVE_INFINITY;
  for (let index = 0; index < (options.maxJobs ?? 20); index += 1) {
    if (Date.now() - started > budgetMs || batchesLeft <= 0) break;
    const now = options.now || new Date();
    const job = await claimDateSyncJob(owner, now);
    if (!job) break;
    summary.jobs += 1;
    const outcome = await runDateSyncJob(job, {
      owner,
      batchSize,
      deadline: started + budgetMs,
      maxBatches: batchesLeft,
      now: options.now,
    });
    batchesLeft -= outcome.batches;
    summary.processed += outcome.processed;
    summary.moved += outcome.moved;
    summary.failed += outcome.failed;
    if (outcome.completed) summary.completed += 1;
    else summary.continuing += 1;
    // Out of time or batches: what is left — this job included — is the
    // next run's. (Re-claiming it here would only spin past the limit.)
    if (outcome.yielded) break;
  }
  return summary;
}

async function claimDateSyncJob(owner: string, now: Date): Promise<SyncJobProduct | null> {
  return (await Product.findOneAndUpdate(
    {
      "preorderDateSync.state": { $in: ["pending", "running"] },
      $and: [
        {
          $or: [
            { "preorderDateSync.leaseUntil": { $exists: false } },
            { "preorderDateSync.leaseUntil": null },
            { "preorderDateSync.leaseUntil": { $lt: now } },
          ],
        },
        {
          $or: [
            { "preorderDateSync.nextAttemptAt": { $exists: false } },
            { "preorderDateSync.nextAttemptAt": null },
            { "preorderDateSync.nextAttemptAt": { $lte: now } },
          ],
        },
      ],
    },
    {
      $set: {
        "preorderDateSync.state": "running",
        "preorderDateSync.leaseOwner": owner,
        "preorderDateSync.leaseUntil": new Date(now.getTime() + LEASE_MS),
      },
      $inc: { "preorderDateSync.fence": 1 },
    },
    {
      sort: { "preorderDateSync.requestedAt": 1, _id: 1 },
      returnDocument: "after",
      timestamps: false,
    },
  )
    .select("_id name title preorder variants._id variants.preorder preorderTermsRevision preorderDateSync")
    .lean()) as SyncJobProduct | null;
}

async function runDateSyncJob(
  job: SyncJobProduct,
  options: { owner: string; batchSize: number; deadline: number; maxBatches?: number; now?: Date },
): Promise<{
  completed: boolean;
  /** Stopped for time or the batch limit, not for anything about the job. */
  yielded?: boolean;
  batches: number;
  processed: number;
  moved: number;
  failed: number;
}> {
  const productId = id(job._id);
  const fence = Number(job.preorderDateSync?.fence || 0);
  const revision = Number(job.preorderTermsRevision || 0);
  const restart = Number(job.preorderDateSync?.runRevision ?? -1) !== revision;
  let cursor: Types.ObjectId | undefined = restart ? undefined : job.preorderDateSync?.cursor;
  const tally = { batches: 0, processed: 0, moved: 0, failed: 0 };
  const owned = (extra: Record<string, unknown> = {}) => ({
    _id: job._id,
    "preorderDateSync.leaseOwner": options.owner,
    "preorderDateSync.fence": fence,
    ...extra,
  });

  if (restart) {
    const begun = await Product.updateOne(
      owned(),
      {
        $set: {
          "preorderDateSync.runRevision": revision,
          "preorderDateSync.processed": 0,
          "preorderDateSync.moved": 0,
          "preorderDateSync.startedAt": options.now || new Date(),
          "preorderDateSync.failures": [],
        },
        $unset: { "preorderDateSync.cursor": "" },
      },
      { timestamps: false },
    );
    if (begun.matchedCount !== 1) return { completed: false, ...tally };
  }

  const failures = new Map<string, { error: string; attempts: number }>(
    restart
      ? []
      : (job.preorderDateSync?.failures || []).map((failure) => [
          id(failure.orderId),
          { error: String(failure.error || ""), attempts: Number(failure.attempts || 1) },
        ]),
  );

  for (;;) {
    if (
      Date.now() > options.deadline ||
      (options.maxBatches !== undefined && tally.batches >= options.maxBatches)
    ) {
      await releaseJob(job, options.owner, fence, "running");
      return { completed: false, yielded: true, ...tally };
    }
    // The product as it stands now: a newer edit restarts the scan.
    const current = await Product.findById(job._id)
      .select("preorderTermsRevision")
      .lean<{ preorderTermsRevision?: number } | null>();
    if (Number(current?.preorderTermsRevision || 0) !== revision) {
      await Product.updateOne(
        owned(),
        { $set: { "preorderDateSync.state": "pending" }, $unset: { "preorderDateSync.leaseOwner": "", "preorderDateSync.leaseUntil": "" } },
        { timestamps: false },
      );
      return { completed: false, ...tally };
    }
    const batch = await Order.find({
      "items.productId": job._id,
      hasPreorder: true,
      ...(cursor ? { _id: { $gt: cursor } } : {}),
    })
      .sort({ _id: 1 })
      .limit(options.batchSize)
      .select("_id")
      .lean<Array<{ _id: Types.ObjectId }>>();
    if (batch.length === 0) break;
    tally.batches += 1;
    for (const { _id } of batch) {
      const result = await reconcileOrderPreorderTerms(String(_id), {
        now: options.now,
        productId,
      }).catch((error: unknown): ReconcileTermsResult & { error?: string } => ({
        status: "conflict",
        error: error instanceof Error ? error.message : String(error),
      }));
      tally.processed += 1;
      if (result.status === "moved") tally.moved += 1;
      if (result.status === "conflict") {
        const previous = failures.get(String(_id));
        failures.set(String(_id), {
          error: ("error" in result && result.error) || "The order changed during the update",
          attempts: (previous?.attempts || 0) + 1,
        });
        tally.failed += 1;
      } else {
        failures.delete(String(_id));
      }
    }
    cursor = batch[batch.length - 1]._id;
    // Progress, under the fence: a worker that lost its lease stops here.
    const progressed = await Product.updateOne(
      owned({ "preorderDateSync.runRevision": revision }),
      {
        $set: {
          "preorderDateSync.cursor": cursor,
          "preorderDateSync.lastProgressAt": new Date(),
          "preorderDateSync.leaseUntil": new Date(Date.now() + LEASE_MS),
          "preorderDateSync.failures": [...failures.entries()]
            .slice(0, MAX_RECORDED_FAILURES)
            .map(([orderId, failure]) => ({
              orderId: new Types.ObjectId(orderId),
              error: failure.error.slice(0, 300),
              attempts: failure.attempts,
              at: new Date(),
            })),
        },
        $inc: {
          "preorderDateSync.processed": batch.length,
          "preorderDateSync.moved": tally.moved,
        },
      },
      { timestamps: false },
    );
    tally.moved = 0;
    if (progressed.matchedCount !== 1) return { completed: false, ...tally };
    if (batch.length < options.batchSize) break;
  }

  // Failed rows are retried before the job may finish.
  for (const [orderId] of [...failures.entries()]) {
    const retried = await reconcileOrderPreorderTerms(orderId, { now: options.now, productId }).catch(
      () => ({ status: "conflict" as const }),
    );
    if (retried.status !== "conflict") failures.delete(orderId);
  }
  if (failures.size > 0) {
    const attempts = Math.max(...[...failures.values()].map((failure) => failure.attempts));
    await Product.updateOne(
      owned(),
      {
        $set: {
          "preorderDateSync.state": "pending",
          "preorderDateSync.nextAttemptAt": new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
          "preorderDateSync.failures": [...failures.entries()].slice(0, MAX_RECORDED_FAILURES).map(([orderId, failure]) => ({
            orderId: new Types.ObjectId(orderId),
            error: failure.error.slice(0, 300),
            attempts: failure.attempts,
            at: new Date(),
          })),
          "preorderDateSync.lastError": `${failures.size} order(s) could not be updated yet`,
        },
        $unset: { "preorderDateSync.leaseOwner": "", "preorderDateSync.leaseUntil": "" },
      },
      { timestamps: false },
    );
    return { completed: false, ...tally };
  }

  // Done — only if no newer edit arrived, and only by the lease holder.
  const finished = await Product.updateOne(
    owned({ preorderTermsRevision: revision }),
    {
      $set: {
        "preorderDateSync.state": "idle",
        "preorderDateSync.appliedRevision": revision,
        "preorderDateSync.completedAt": new Date(),
        "preorderDateSync.failures": [],
      },
      $unset: {
        "preorderDateSync.cursor": "",
        "preorderDateSync.leaseOwner": "",
        "preorderDateSync.leaseUntil": "",
        "preorderDateSync.nextAttemptAt": "",
        "preorderDateSync.lastError": "",
      },
    },
    { timestamps: false },
  );
  if (finished.matchedCount !== 1) {
    await Product.updateOne(
      owned(),
      { $set: { "preorderDateSync.state": "pending" }, $unset: { "preorderDateSync.leaseOwner": "", "preorderDateSync.leaseUntil": "" } },
      { timestamps: false },
    );
    return { completed: false, ...tally };
  }
  return { completed: true, ...tally };
}

async function releaseJob(
  job: SyncJobProduct,
  owner: string,
  fence: number,
  state: "running" | "pending",
): Promise<void> {
  await Product.updateOne(
    { _id: job._id, "preorderDateSync.leaseOwner": owner, "preorderDateSync.fence": fence },
    {
      $set: { "preorderDateSync.state": state },
      $unset: { "preorderDateSync.leaseOwner": "", "preorderDateSync.leaseUntil": "" },
    },
    { timestamps: false },
  );
}

/**
 * Recent pre-orders nothing has reconciled yet — the one placed on old terms
 * while a scan was running, whose own check never ran. Bounded by age, so it
 * never turns into a scan of history.
 */
export async function catchUpPreorderTerms(
  options: { now?: Date; limit?: number; windowDays?: number } = {},
): Promise<{ checked: number; moved: number }> {
  const now = options.now || new Date();
  const windowStart = new Date(now.getTime() - (options.windowDays ?? 7) * 24 * 60 * 60 * 1000);
  const settled = new Date(now.getTime() - 5 * 60 * 1000);
  const orders = await Order.find({
    hasPreorder: true,
    preorderTermsCheckedAt: null,
    createdAt: { $gte: windowStart, $lt: settled },
  })
    .sort({ createdAt: 1 })
    .limit(Math.min(Math.max(options.limit ?? 200, 1), 1000))
    .select("_id")
    .lean<Array<{ _id: Types.ObjectId }>>();
  let moved = 0;
  for (const order of orders) {
    const result = await reconcileOrderPreorderTerms(String(order._id), { now }).catch(
      () => ({ status: "conflict" as const }),
    );
    if (result.status === "moved") moved += 1;
    // Stamped whatever the answer, bar a conflict: an order this pass cannot
    // change (cancelled, nothing waiting) must not come back every run.
    if (result.status === "unchanged" || result.status === "skipped") {
      await Order.updateOne(
        { _id: order._id, preorderTermsCheckedAt: null },
        { $set: { preorderTermsCheckedAt: now } },
      );
    }
  }
  return { checked: orders.length, moved };
}

/** Where the date jobs stand — for cron health and the operator screens. */
export async function dateSyncHealth(now: Date = new Date()): Promise<{
  pending: number;
  running: number;
  withFailures: number;
  oldestRequestedAt: Date | null;
}> {
  const [pending, running, withFailures, oldest] = await Promise.all([
    Product.countDocuments({ "preorderDateSync.state": "pending" }),
    Product.countDocuments({ "preorderDateSync.state": "running" }),
    Product.countDocuments({
      "preorderDateSync.state": { $in: ["pending", "running"] },
      "preorderDateSync.failures.0": { $exists: true },
    }),
    Product.findOne({ "preorderDateSync.state": { $in: ["pending", "running"] } })
      .sort({ "preorderDateSync.requestedAt": 1 })
      .select("preorderDateSync.requestedAt")
      .lean<{ preorderDateSync?: { requestedAt?: Date } } | null>(),
  ]);
  void now;
  return {
    pending,
    running,
    withFailures,
    oldestRequestedAt: oldest?.preorderDateSync?.requestedAt || null,
  };
}

/** Put a stuck or failed job back in the queue — the operator's Retry. */
export async function retryPreorderDateSync(productId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(productId)) return false;
  const written = await Product.updateOne(
    { _id: productId, "preorderDateSync.state": { $in: ["pending", "running"] } },
    {
      $set: { "preorderDateSync.state": "pending" },
      $unset: {
        "preorderDateSync.nextAttemptAt": "",
        "preorderDateSync.leaseOwner": "",
        "preorderDateSync.leaseUntil": "",
      },
    },
    { timestamps: false },
  );
  return written.matchedCount === 1;
}
