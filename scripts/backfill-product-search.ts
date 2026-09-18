import { connectDB, mongoose } from "@/lib/db";
import { PRODUCT_SEARCH_INDEX_VERSION } from "@/lib/products/search";
import {
  STALE_SEARCH_INDEX_FILTER,
  backfillProductSearchIndex,
} from "@/lib/products/search-index";
import { Product } from "@/models";
import { ZERO_RESULT_SEARCH_RETENTION_DAYS } from "@/models/zero-result-search.model";

/**
 * Product search index backfill
 * =============================
 *
 * The storefront search runs on a `search` block every product carries —
 * the prefix-matchable words of its name, codes, tags, options and variants,
 * plus the words of its descriptions for the fallback pass (see
 * lib/products/search.ts). The Product model writes the block on every
 * save, and `syncProductAggregates` after every `findOneAndUpdate`; this
 * script gives it to the catalogue a store already had before 2.1.
 *
 * Four steps, each idempotent:
 *   1. Drop the former text index (name/title/description/tags). Nothing
 *      reads it any more, and Mongoose never drops an index on its own.
 *   2. Ensure the `search.terms` index the search matches against.
 *   3. Ensure the two indexes of `zeroresultsearches`, the Search insights
 *      report's counters: the unique upsert key, and the TTL that drops a
 *      day once it leaves the retention window.
 *   4. Build the block for every product that lacks one, or carries one
 *      from an older builder (`search.v` behind PRODUCT_SEARCH_INDEX_VERSION).
 *      `--rebuild` recomputes every product regardless — for a search-rule
 *      change that did not bump the version.
 *
 * Until it runs, the storefront answers searches with an unindexed substring
 * match over the primary fields and logs a reminder; a search on a partly
 * indexed catalogue also queues a bounded batch of this work in the
 * background. Running it once is still the way to upgrade.
 *
 * Note: `connectDB()` honours MONGODB_AUTO_INDEX, so on a store with
 * automatic indexing left on the `search.terms` index may already have been
 * created by the time step 2 looks — including during a dry run.
 *
 * Usage:
 *   pnpm db:migrate product-search --dry-run   # prints host/db and what would change
 *   pnpm db:migrate product-search
 *   pnpm db:migrate product-search -- --rebuild
 */

const DRY_RUN = process.argv.includes("--dry-run");
const REBUILD = process.argv.includes("--rebuild");
const BATCH_SIZE = 500;
const TERMS_INDEX_NAME = "search.terms_1";

type IndexRow = {
  name?: string;
  key?: Record<string, unknown>;
  weights?: unknown;
};

async function run() {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database connection not available");

  console.log("✓ Connected to MongoDB");
  console.log(`   host: ${mongoose.connection.host}`);
  console.log(`   db:   ${db.databaseName}`);
  console.log(
    `\n🔎 Product search index${DRY_RUN ? " (DRY RUN)" : ""}${REBUILD ? " — full rebuild" : ""}...\n`,
  );

  const collection = db.collection("products");
  const indexes = (await collection.indexes().catch(() => [])) as IndexRow[];

  // 1. The legacy text index. Matched on shape, not on name: a text index
  //    created by hand carries a different name from the one Mongoose gave it.
  const textIndexes = indexes.filter(
    (index) =>
      index.weights !== undefined ||
      Object.values(index.key ?? {}).includes("text"),
  );
  for (const index of textIndexes) {
    if (!index.name) continue;
    if (DRY_RUN) {
      console.log(`  - would drop text index ${index.name}`);
    } else {
      await collection.dropIndex(index.name);
      console.log(`  - dropped text index ${index.name}`);
    }
  }
  if (textIndexes.length === 0) console.log("  = no text index to drop");

  // 2. The terms index.
  if (indexes.some((index) => index.name === TERMS_INDEX_NAME)) {
    console.log(`  = ${TERMS_INDEX_NAME} already present`);
  } else if (DRY_RUN) {
    console.log(`  + would create ${TERMS_INDEX_NAME}`);
  } else {
    await collection.createIndex(
      { "search.terms": 1 },
      { name: TERMS_INDEX_NAME, background: true },
    );
    console.log(`  + created ${TERMS_INDEX_NAME}`);
  }

  // 3. The Search insights counters. Created empty if absent — the first
  //    zero-result search would create the collection anyway, without these.
  const misses = db.collection("zeroresultsearches");
  const missIndexes = (await misses.indexes().catch(() => [])) as IndexRow[];
  const wantedMissIndexes: Array<{
    name: string;
    key: Record<string, 1>;
    options: { unique?: boolean; expireAfterSeconds?: number };
  }> = [
    {
      name: "day_1_source_1_query_1",
      key: { day: 1, source: 1, query: 1 },
      options: { unique: true },
    },
    {
      name: "day_1",
      key: { day: 1 },
      options: {
        expireAfterSeconds: ZERO_RESULT_SEARCH_RETENTION_DAYS * 24 * 60 * 60,
      },
    },
  ];
  for (const { name, key, options } of wantedMissIndexes) {
    if (missIndexes.some((index) => index.name === name)) {
      console.log(`  = zeroresultsearches.${name} already present`);
    } else if (DRY_RUN) {
      console.log(`  + would create zeroresultsearches.${name}`);
    } else {
      await misses.createIndex(key, { name, background: true, ...options });
      console.log(`  + created zeroresultsearches.${name}`);
    }
  }

  // 4. The blocks.
  const total = await Product.countDocuments({});
  const pending = REBUILD
    ? total
    : await Product.countDocuments(STALE_SEARCH_INDEX_FILTER);
  console.log(
    `\n  ${pending} of ${total} products ${
      REBUILD
        ? "to rebuild"
        : `not yet indexed by builder v${PRODUCT_SEARCH_INDEX_VERSION}`
    }`,
  );

  if (DRY_RUN) {
    console.log("\n✅ Dry run complete — nothing written.");
  } else if (pending === 0) {
    console.log("\n✅ Nothing to do — every product is indexed.");
  } else {
    const result = await backfillProductSearchIndex({
      rebuild: REBUILD,
      batchSize: BATCH_SIZE,
      onBatch: ({ scanned }) => console.log(`  … ${scanned}/${pending}`),
    });
    console.log(
      `\n✅ Done — ${result.updated} of ${result.scanned} products written.`,
    );
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("❌ Migration failed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
