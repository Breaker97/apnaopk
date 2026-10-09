import "server-only";

import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import {
  countMetaSkips,
  createMetaBatchMapper,
  META_PRODUCT_SELECT,
  metaFeedProductFilter,
  type MetaFeedSetup,
} from "@/lib/meta-catalog/feed-source";
import type { MetaCatalogProductSource } from "@/lib/meta-catalog/map-product";
import { metaItemHash } from "@/lib/meta-catalog/sync-batch";
import { writeMarks } from "@/lib/meta-catalog/sync-marks";
import { Product } from "@/models";
import {
  MetaCatalogFeed,
  type IMetaCatalogLive,
} from "@/models/meta-catalog-feed.model";
import { MetaCatalogSync } from "@/models/meta-catalog-sync.model";

/**
 * The safety net under the marks: once an hour (or when asked) every product
 * the storefront shows is mapped again and compared with what Meta was last
 * sent. Whatever differs — a write no call site marked, a pre-order whose
 * window opened by the clock, a script's raw update — is marked, and so is
 * every product Meta still holds items for that is gone or hidden now, which
 * the worker then deletes.
 *
 * Two walks by `_id`, products then sync rows, a batch at a time, with the
 * cursor saved after each batch: a large catalogue is checked across several
 * runs, and a run that dies picks up where it stopped. One walk at a time,
 * under a lease on the catalog row.
 */

export const RECONCILE_EVERY_MS = 60 * 60_000;
const LEASE_MS = 2 * 60_000;
const BATCH_SIZE = 500;
const KEY = { key: "default" } as const;

type Reconcile = NonNullable<IMetaCatalogLive["reconcile"]>;
type Stats = { itemCount: number; preorder: number; noImage: number; noPrice: number };

export type ReconcileOutcome = {
  ran: boolean;
  finished?: boolean;
  products?: number;
  rows?: number;
  marked?: number;
};

function isDue(reconcile: Reconcile | undefined, lastReconciledAt: Date | undefined, now: number) {
  if (reconcile?.phase || reconcile?.requestedAt) return true;
  return !lastReconciledAt || now - new Date(lastReconciledAt).getTime() >= RECONCILE_EVERY_MS;
}

async function claimWalk(now: Date): Promise<Reconcile | null> {
  const row = await MetaCatalogFeed.findOneAndUpdate(
    {
      ...KEY,
      $or: [
        { "live.reconcile.leaseUntil": { $exists: false } },
        { "live.reconcile.leaseUntil": null },
        { "live.reconcile.leaseUntil": { $lte: now } },
      ],
    },
    { $set: { "live.reconcile.leaseUntil": new Date(now.getTime() + LEASE_MS) } },
    { returnDocument: "after" },
  )
    .select("live.reconcile")
    .lean<{ live?: { reconcile?: Reconcile } }>();
  return row?.live?.reconcile ?? null;
}

async function saveProgress(update: Record<string, unknown>, unset: string[] = []) {
  await MetaCatalogFeed.updateOne(KEY, {
    ...(Object.keys(update).length ? { $set: update } : {}),
    ...(unset.length ? { $unset: Object.fromEntries(unset.map((field) => [field, ""])) } : {}),
  });
}

function sameItems(
  sent: ReadonlyArray<{ id: string; hash: string }>,
  next: ReadonlyArray<{ id: string; hash: string }>,
): boolean {
  if (sent.length !== next.length) return false;
  const hashes = new Map(sent.map((entry) => [entry.id, entry.hash]));
  return next.every((entry) => hashes.get(entry.id) === entry.hash);
}

/**
 * Advance the walk for as long as `deadline` allows. Returns without doing
 * anything when no walk is due or another run holds it.
 */
export async function continueMetaCatalogReconcile(params: {
  setup: MetaFeedSetup;
  imageToken: string;
  deadline: number;
  live: Pick<IMetaCatalogLive, "reconcile" | "lastReconciledAt">;
}): Promise<ReconcileOutcome> {
  await connectDB();
  const now = new Date();
  if (!isDue(params.live.reconcile, params.live.lastReconciledAt, now.getTime())) {
    return { ran: false };
  }
  let walk = await claimWalk(now);
  if (!walk) return { ran: false };

  if (!walk.phase) {
    // A new walk. A request that arrives from here on asks for the next one.
    const force = walk.forceRequested === true;
    walk = {
      phase: "products",
      startedAt: now,
      force,
      stats: { itemCount: 0, preorder: 0, noImage: 0, noPrice: 0 },
      leaseUntil: walk.leaseUntil,
    };
    await saveProgress(
      {
        "live.reconcile.phase": "products",
        "live.reconcile.startedAt": now,
        "live.reconcile.force": force,
        "live.reconcile.stats": walk.stats,
      },
      ["live.reconcile.cursor", "live.reconcile.requestedAt", "live.reconcile.forceRequested"],
    );
  }

  const mapBatch = createMetaBatchMapper({ token: params.imageToken, setup: params.setup });
  const filter = metaFeedProductFilter(params.setup);
  const stats: Stats = { itemCount: 0, preorder: 0, noImage: 0, noPrice: 0, ...walk.stats };
  const outcome: ReconcileOutcome = { ran: true, products: 0, rows: 0, marked: 0 };
  let cursor: Types.ObjectId | null = (walk.cursor as Types.ObjectId | undefined) ?? null;

  while (Date.now() < params.deadline) {
    if (walk.phase === "products") {
      const batch = await Product.find(cursor ? { ...filter, _id: { $gt: cursor } } : filter)
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .select(META_PRODUCT_SELECT)
        .lean<Array<MetaCatalogProductSource & { _id: Types.ObjectId }>>();
      if (batch.length === 0) {
        walk.phase = "rows";
        cursor = null;
        await saveProgress({ "live.reconcile.phase": "rows" }, ["live.reconcile.cursor"]);
        continue;
      }

      const mapped = await mapBatch(batch);
      for (const { result } of mapped) stats.itemCount += result.items.length;
      const skipped = { preorder: 0, noImage: 0, noPrice: 0 };
      countMetaSkips(skipped, mapped.map(({ result }) => result));
      stats.preorder += skipped.preorder;
      stats.noImage += skipped.noImage;
      stats.noPrice += skipped.noPrice;

      const rows = await MetaCatalogSync.find({ productId: { $in: batch.map((p) => p._id) } })
        .select("productId items")
        .lean<Array<{ productId: Types.ObjectId; items?: Array<{ id: string; hash: string }> }>>();
      const sentByProduct = new Map(rows.map((row) => [String(row.productId), row.items ?? []]));

      const changed: Types.ObjectId[] = [];
      for (const { product, result } of mapped) {
        const sent = sentByProduct.get(String(product._id));
        const next = result.items.map((item) => ({ id: item.id, hash: metaItemHash(item) }));
        // Nothing sent and nothing to send: no row is needed.
        if (!sent && next.length === 0) continue;
        if (walk.force || !sameItems(sent ?? [], next)) changed.push(product._id as Types.ObjectId);
      }
      if (changed.length > 0) {
        await writeMarks(changed, 0, { clearHashes: walk.force === true });
        outcome.marked! += changed.length;
      }

      outcome.products! += batch.length;
      cursor = batch[batch.length - 1]._id;
      await saveProgress({ "live.reconcile.cursor": cursor, "live.reconcile.stats": stats });
      continue;
    }

    // Rows Meta holds items for whose product is gone or no longer shown.
    const rows = await MetaCatalogSync.find({
      ...(cursor ? { _id: { $gt: cursor } } : {}),
      "items.0": { $exists: true },
    })
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .select("_id productId")
      .lean<Array<{ _id: Types.ObjectId; productId: Types.ObjectId }>>();
    if (rows.length === 0) {
      await saveProgress(
        { "live.lastReconciledAt": new Date(), "live.lastReconcileStats": stats },
        [
          "live.reconcile.phase",
          "live.reconcile.cursor",
          "live.reconcile.startedAt",
          "live.reconcile.force",
          "live.reconcile.stats",
          "live.reconcile.leaseUntil",
        ],
      );
      outcome.finished = true;
      return outcome;
    }
    const shown = new Set(
      (
        await Product.find({ ...filter, _id: { $in: rows.map((row) => row.productId) } })
          .select("_id")
          .lean<Array<{ _id: Types.ObjectId }>>()
      ).map((product) => String(product._id)),
    );
    const gone = rows.filter((row) => !shown.has(String(row.productId))).map((row) => row.productId);
    if (gone.length > 0) {
      await writeMarks(gone, 0);
      outcome.marked! += gone.length;
    }
    outcome.rows! += rows.length;
    cursor = rows[rows.length - 1]._id;
    await saveProgress({ "live.reconcile.cursor": cursor });
  }

  // Out of time: the next run carries on from the saved cursor.
  await saveProgress({}, ["live.reconcile.leaseUntil"]);
  return outcome;
}
