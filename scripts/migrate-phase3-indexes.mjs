import mongoose from "mongoose";

/**
 * Query-audit index migration (September 2026 codebase audit, Phase 3)
 * ==================================================================
 *
 * Adds the two indexes the data-layer audit found missing on real query
 * shapes. Purely additive — nothing is dropped or replaced:
 *
 *   user             { status: 1 }
 *     The customers stats card counts active customers by subtracting the
 *     (rare) non-active accounts; the staff/assignment lists filter on the
 *     same field. Both scanned the users collection.
 *
 *   platformpayments { provider: 1, status: 1, createdAt: -1 }
 *     The MTN MoMo and Orange Money reconciliation crons sweep pending
 *     attempts by provider inside a time window. Every existing index on the
 *     collection starts with `kind` or a gateway reference, so each run was
 *     a collection scan.
 *
 * Stores that leave Mongoose `autoIndex` on get both on the next boot; this
 * script exists for deployments that run with MONGODB_AUTO_INDEX=false.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-phase3-indexes.mjs            (apply)
 *   node --env-file=.env scripts/migrate-phase3-indexes.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

const ENSURE = {
  user: [{ name: "status_1", key: { status: 1 } }],
  platformpayments: [
    {
      name: "provider_1_status_1_createdAt_-1",
      key: { provider: 1, status: 1, createdAt: -1 },
    },
  ],
};

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
  for (const [collectionName, wanted] of Object.entries(ENSURE)) {
    const collection = db.collection(collectionName);
    const existing = await collection.indexes().catch(() => []);
    const byName = new Map(existing.map((index) => [index.name, index]));
    for (const { name, key } of wanted) {
      if (byName.has(name)) {
        console.log(`  = ${collectionName}.${name} already present`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  + would create ${collectionName}.${name} ${JSON.stringify(key)}`);
      } else {
        await collection.createIndex(key, { name, background: true });
        console.log(`  + created ${collectionName}.${name} ${JSON.stringify(key)}`);
      }
      created += 1;
    }
  }

  console.log(
    DRY_RUN
      ? `✅ Dry run complete — ${created} index(es) would be created.`
      : `✅ Done — ${created} index(es) created.`,
  );
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("❌ Migration failed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
