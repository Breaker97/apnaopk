import { unstable_cache } from "next/cache";
import { PRODUCT_STATUS } from "@/config/app.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import {
  PRODUCT_SEARCH_INDEX_VERSION,
  PRODUCT_SEARCH_SOURCE_SELECT,
  buildProductSearchIndex,
  type ProductSearchSource,
} from "@/lib/products/search";
import { Product } from "@/models";

/**
 * Maintenance of the per-product `search` block — the half of the search
 * engine that touches the database. The block itself is built by
 * `buildProductSearchIndex` (lib/products/search.ts) and written by the
 * Product model on every save and by `syncProductAggregates` after every
 * `findOneAndUpdate`; this module covers the products those paths never saw:
 * the catalogue an upgrading store already has, and a seeded snapshot.
 */

/** Rows whose block is missing, or built by an older version of the builder. */
export const STALE_SEARCH_INDEX_FILTER = {
  "search.v": { $ne: PRODUCT_SEARCH_INDEX_VERSION },
} as const;

type ProductSearchBackfillOptions = {
  /** Products per bulk write. */
  batchSize?: number;
  /** Stop after this many batches — the storefront's self-heal uses it. */
  maxBatches?: number;
  /** Recompute every product, not only the stale ones. */
  rebuild?: boolean;
  onBatch?: (progress: { scanned: number; updated: number }) => void;
};

type ProductSearchBackfillResult = {
  scanned: number;
  updated: number;
  /** True when `maxBatches` stopped the pass before the cursor ran dry. */
  truncated: boolean;
};

/**
 * Rebuild the `search` block of every product the filter selects, in
 * batches. Walks the `_id` index so the rows it rewrites can never be
 * revisited by its own cursor. Idempotent: a second pass over an indexed
 * catalogue writes nothing.
 */
export async function backfillProductSearchIndex(
  options: ProductSearchBackfillOptions = {},
): Promise<ProductSearchBackfillResult> {
  const batchSize = Math.max(1, options.batchSize ?? 500);
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;

  await connectDB();

  const cursor = Product.find(options.rebuild ? {} : STALE_SEARCH_INDEX_FILTER)
    .select(PRODUCT_SEARCH_SOURCE_SELECT)
    .sort({ _id: 1 })
    .lean()
    .cursor({ batchSize });

  let scanned = 0;
  let updated = 0;
  let batches = 0;
  let truncated = false;
  let operations: {
    updateOne: {
      filter: { _id: unknown };
      update: { $set: { search: ReturnType<typeof buildProductSearchIndex> } };
    };
  }[] = [];

  const flush = async () => {
    if (operations.length === 0) return;
    const result = await Product.bulkWrite(operations, { ordered: false });
    updated += result.modifiedCount + result.upsertedCount;
    operations = [];
    batches += 1;
    options.onBatch?.({ scanned, updated });
  };

  for await (const doc of cursor) {
    scanned += 1;
    operations.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { search: buildProductSearchIndex(doc) } },
      },
    });
    if (operations.length >= batchSize) {
      await flush();
      if (batches >= maxBatches) {
        truncated = true;
        break;
      }
    }
  }
  if (!truncated) await flush();

  return { scanned, updated, truncated };
}

type ProductSearchCoverage = {
  /** Active products in the catalogue. */
  total: number;
  /** Of those, the ones carrying a current `search` block. */
  indexed: number;
};

/**
 * How much of the live catalogue the search index covers. Read on every
 * search so the storefront can tell an un-migrated store from an empty
 * result; cached under the products tag, which every product write busts.
 */
export const getProductSearchCoverage = unstable_cache(
  async (): Promise<ProductSearchCoverage> => {
    await connectDB();
    const [total, indexed] = await Promise.all([
      Product.countDocuments({ status: PRODUCT_STATUS.ACTIVE }),
      Product.countDocuments({
        status: PRODUCT_STATUS.ACTIVE,
        "search.v": PRODUCT_SEARCH_INDEX_VERSION,
      }),
    ]);
    return { total, indexed };
  },
  ["product-search-coverage"],
  { revalidate: 60, tags: [CACHE_TAGS.products] },
);

const HEAL_INTERVAL_MS = 60_000;
const HEAL_BATCH_SIZE = 200;
let nextHealAt = 0;

/**
 * Index the products the migration never reached, a bounded batch at a time,
 * off the request path.
 *
 * The migration is still the way to upgrade — this exists so a store that
 * skipped it converges on a working search within minutes instead of
 * searching a catalogue that is silently missing products. Throttled per
 * process, capped per run, and never awaited by the caller: a search is never
 * slower for it, and a failure here is a log line, not an error page.
 */
export function scheduleProductSearchIndexHeal(): void {
  const now = Date.now();
  if (now < nextHealAt) return;
  nextHealAt = now + HEAL_INTERVAL_MS;

  const heal = async () => {
    try {
      const coverage = await getProductSearchCoverage();
      if (coverage.indexed >= coverage.total) return;
      console.warn(
        `[product-search] ${coverage.total - coverage.indexed} of ${coverage.total} active products are not in the search index. Run \`pnpm db:migrate product-search\`; indexing up to ${HEAL_BATCH_SIZE} of them now.`,
      );
      await backfillProductSearchIndex({
        batchSize: HEAL_BATCH_SIZE,
        maxBatches: 1,
      });
    } catch (error) {
      console.warn("[product-search] background indexing failed", error);
    }
  };

  // `after()` keeps the work alive past the response on serverless hosts. It
  // throws outside a request scope (a script, a test), where a detached
  // promise is all that is needed.
  void import("next/server")
    .then(({ after }) => after(heal))
    .catch(() => heal());
}
