import mongoose from "mongoose";

/**
 * Index migration for the Meta catalog (3.0, October 2026)
 * ========================================================
 *
 * Creates the indexes Settings → Meta catalog relies on: the feed's single
 * row, and the live sync's per-product rows and batch handles. Purely
 * additive: nothing is dropped and nothing is rebuilt, so it is safe to re-run
 * and safe to run on a store that is already up to date.
 *
 * Stores that leave Mongoose `autoIndex` on get them on the next boot. This
 * script exists for deployments running with MONGODB_AUTO_INDEX=false — there,
 * an index that no migration creates is an index the store never gets, and the
 * unique one on `metacatalogsyncs.productId` is what makes two marks of the
 * same product meet on one row instead of two.
 *
 *   metacatalogfeeds { key } unique
 *     The one Meta catalog row.
 *
 *   metacatalogsyncs { productId } unique, { dirty, nextAttemptAt },
 *   { leaseUntil } sparse, { errorCount, lastErrorAt }
 *     One row per product; the worker's due-row claim; leases left by a run
 *     that died; the page's list of items Meta refused.
 *
 *   metacatalogbatches { handle } unique, { nextCheckAt }, { expiresAt } TTL
 *     Catalog Batch calls Meta is still ingesting, checked on a schedule and
 *     expired with the row.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-meta-catalog-indexes.mjs            (apply)
 *   node --env-file=.env scripts/migrate-meta-catalog-indexes.mjs --dry-run  (report only)
 */
const DRY_RUN = process.argv.includes("--dry-run");
// Names and options match what Mongoose derives from the schema, so a later
// autoIndex boot sees them as already present rather than as conflicts.
const ENSURE = [
  ["metacatalogfeeds", [{ name: "key_1", key: { key: 1 }, options: { unique: true } }]],
  [
    "metacatalogsyncs",
    [
      { name: "productId_1", key: { productId: 1 }, options: { unique: true } },
      { name: "dirty_1_nextAttemptAt_1", key: { dirty: 1, nextAttemptAt: 1 } },
      { name: "leaseUntil_1", key: { leaseUntil: 1 }, options: { sparse: true } },
      { name: "errorCount_1_lastErrorAt_-1", key: { errorCount: 1, lastErrorAt: -1 } },
    ],
  ],
  [
    "metacatalogbatches",
    [
      { name: "handle_1", key: { handle: 1 }, options: { unique: true } },
      { name: "nextCheckAt_1", key: { nextCheckAt: 1 } },
      { name: "expiresAt_1", key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
    ],
  ],
];

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI;
  const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;
  if (!MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI, {
    ...(MONGODB_DB_NAME ? { dbName: MONGODB_DB_NAME } : {}),
  });
  const db = mongoose.connection.db;
  console.log(
    `${DRY_RUN ? "🔍 Dry run" : "🚀 Applying"} on database "${db.databaseName}"`,
  );

  let created = 0;
  let failed = 0;
  for (const [collectionName, wanted] of ENSURE) {
    const collection = db.collection(collectionName);
    const existing = await collection.indexes().catch(() => []);
    const byName = new Set(existing.map((index) => index.name));
    for (const { name, key, options = {} } of wanted) {
      if (byName.has(name)) {
        console.log(`  = ${collectionName}.${name} already present`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  + would create ${collectionName}.${name} ${JSON.stringify(key)}`);
        created += 1;
        continue;
      }
      try {
        await collection.createIndex(key, { name, background: true, ...options });
        console.log(`  + created ${collectionName}.${name} ${JSON.stringify(key)}`);
        created += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `  ✗ ${collectionName}.${name} not created: ${error?.message || error}`,
        );
      }
    }
  }

  console.log(
    DRY_RUN
      ? `✅ Dry run complete — ${created} index(es) would be created.`
      : `✅ Done — ${created} index(es) created${failed ? `, ${failed} failed` : ""}.`,
  );
  await mongoose.disconnect();
  if (failed) process.exit(1);
}

run().catch(async (error) => {
  console.error("❌ Migration failed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
