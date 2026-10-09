import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { isMetaLiveSyncActive } from "@/lib/meta-catalog/live-state";
import { Product } from "@/models";
import { MetaCatalogSync } from "@/models/meta-catalog-sync.model";

/**
 * "This product may look different to Meta now." Called where products are
 * written — the editor's save, a sale, a restock, a transfer, an import, a
 * delete — and by the worker's watcher for the changes that are not product
 * writes (a seller suspended, a brand renamed).
 *
 * A mark is one upsert per product and nothing else; the worker decides later
 * what, if anything, Meta needs (./sync-worker.ts). It does nothing while
 * live sync is off, and it never throws: the write it follows has already
 * happened, and the hourly reconcile heals a mark that was lost.
 *
 * The first mark sets when the product is sent, two minutes out, so a burst
 * of sales becomes one request. Later marks before then ride along without
 * moving it, so a product selling every few seconds still goes out within
 * about three minutes. A mark asking for sooner (`delayMs: 0`, the watcher
 * and the reconcile) brings it forward.
 */

export const MARK_DEBOUNCE_MS = 2 * 60_000;
const WRITE_CHUNK = 1000;

function objectIds(values: Iterable<unknown>): Types.ObjectId[] {
  const seen = new Set<string>();
  const ids: Types.ObjectId[] = [];
  for (const value of values) {
    const raw =
      value && typeof value === "object" && "_id" in (value as Record<string, unknown>)
        ? (value as { _id: unknown })._id
        : value;
    const text = raw === null || raw === undefined ? "" : String(raw);
    if (!Types.ObjectId.isValid(text) || seen.has(text)) continue;
    seen.add(text);
    ids.push(new Types.ObjectId(text));
  }
  return ids;
}

function markOperation(
  productId: Types.ObjectId,
  due: Date,
  now: Date,
  clearHashes = false,
) {
  const items = { $ifNull: ["$items", []] };
  return {
    updateOne: {
      filter: { productId },
      // A pipeline, so the new due time can depend on the row as it stands.
      update: [
        {
          $set: {
            productId,
            nextAttemptAt: {
              $cond: [
                { $eq: ["$dirty", true] },
                { $min: ["$nextAttemptAt", due] },
                due,
              ],
            },
            dirty: true,
            attempts: { $ifNull: ["$attempts", 0] },
            // Cleared, every item reads as changed and is sent again.
            items: clearHashes
              ? { $map: { input: items, as: "item", in: { id: "$$item.id", hash: "" } } }
              : items,
            itemErrors: { $ifNull: ["$itemErrors", []] },
            errorCount: { $ifNull: ["$errorCount", 0] },
            createdAt: { $ifNull: ["$createdAt", now] },
            updatedAt: now,
          },
        },
      ],
      upsert: true,
    },
  };
}

/**
 * The upserts themselves, without asking whether live sync is on — for the
 * worker and its reconcile, which only run when it is. `clearHashes` makes
 * every item of these products go out again ("Sync everything now").
 */
export async function writeMarks(
  ids: Types.ObjectId[],
  delayMs: number,
  options: { clearHashes?: boolean } = {},
): Promise<void> {
  const now = new Date();
  const due = new Date(now.getTime() + delayMs);
  const clear = options.clearHashes === true;
  for (let index = 0; index < ids.length; index += WRITE_CHUNK) {
    const chunk = ids.slice(index, index + WRITE_CHUNK);
    try {
      await MetaCatalogSync.collection.bulkWrite(
        chunk.map((id) => markOperation(id, due, now, clear)),
        { ordered: false },
      );
    } catch (error) {
      // Two marks creating the same row at once: one wins, the other meets
      // the unique index. Once more lands on the row the winner made.
      const failed = new Set(
        ((error as { writeErrors?: Array<{ index?: number }> })?.writeErrors ?? [])
          .map((entry) => entry.index)
          .filter((value): value is number => typeof value === "number"),
      );
      if (failed.size === 0) throw error;
      await MetaCatalogSync.collection.bulkWrite(
        chunk
          .filter((_, position) => failed.has(position))
          .map((id) => markOperation(id, due, now, clear)),
        { ordered: false },
      );
    }
  }
}

/** Mark products whose catalog items may have changed. Never throws. */
export async function markProductsForCatalogSync(
  productIds: Iterable<unknown>,
  options: { delayMs?: number } = {},
): Promise<void> {
  try {
    const ids = objectIds(productIds);
    if (ids.length === 0) return;
    if (!(await isMetaLiveSyncActive())) return;
    await connectDB();
    await writeMarks(ids, Math.max(0, options.delayMs ?? MARK_DEBOUNCE_MS));
  } catch (error) {
    console.error("Meta catalog: could not mark products for sync", error);
  }
}

/** Every product matching `filter`, a chunk at a time. */
async function markMatching(
  filter: Record<string, unknown>,
  options: { delayMs?: number },
): Promise<void> {
  try {
    if (!(await isMetaLiveSyncActive())) return;
    await connectDB();
    let after: Types.ObjectId | null = null;
    for (;;) {
      const rows: Array<{ _id: Types.ObjectId }> = await Product.find(
        after ? { ...filter, _id: { $gt: after } } : filter,
      )
        .sort({ _id: 1 })
        .limit(WRITE_CHUNK)
        .select("_id")
        .lean<Array<{ _id: Types.ObjectId }>>();
      if (rows.length === 0) return;
      await writeMarks(
        rows.map((row) => row._id),
        Math.max(0, options.delayMs ?? MARK_DEBOUNCE_MS),
      );
      if (rows.length < WRITE_CHUNK) return;
      after = rows[rows.length - 1]._id;
    }
  } catch (error) {
    console.error("Meta catalog: could not mark products for sync", error);
  }
}

/**
 * A seller's whole catalogue: the seller was approved, suspended, closed or
 * renamed (its name is the brand fallback and `custom_label_0`).
 */
export async function markVendorProductsForCatalogSync(
  vendorId: unknown,
  options: { delayMs?: number } = {},
): Promise<void> {
  const [id] = objectIds([vendorId]);
  if (!id) return;
  await markMatching({ vendorId: id }, options);
}

/** Every product of a brand that was renamed, hidden, restored or deleted. */
export async function markBrandProductsForCatalogSync(
  brandId: unknown,
  options: { delayMs?: number } = {},
): Promise<void> {
  const [id] = objectIds([brandId]);
  if (!id) return;
  await markMatching({ brand: id }, options);
}
