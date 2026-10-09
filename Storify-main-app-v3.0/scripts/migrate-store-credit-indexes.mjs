import mongoose from "mongoose";

/**
 * Index migration for 2.4 (September 2026)
 * ========================================
 *
 * Creates every index the schemas gained in 2.4. Purely additive: nothing is
 * dropped and nothing is rebuilt, so it is safe to re-run and safe to run on a
 * store that is already up to date.
 *
 * Stores that leave Mongoose `autoIndex` on get all of them on the next boot.
 * This script exists for deployments running with MONGODB_AUTO_INDEX=false,
 * which is the recommended production setting — there, an index that no
 * migration creates is an index the store never gets.
 *
 *   storecredittransactions — every index of the collection store credit
 *     introduces: the idempotency key each issue, spend and hold is written
 *     under (UNIQUE — two requests for the same spend must be one), the
 *     shopper's spendable lots oldest-expiry-first, their history, an order's
 *     credit, the hold and expiry sweeps of /api/cron/store-credit, and the
 *     holds a checkout owns.
 *
 *   storecreditaccounts { customerId, currency } unique
 *     One balance per shopper per currency. UNIQUE — see the note below.
 *
 *   orders { storeCredit.holdKey } sparse, { exchangeOf.returnId } sparse
 *     The order a credit hold belongs to, and the exchange order a return
 *     became.
 *
 *   marketingsuppressions { email } unique
 *     One suppression per address, read before every marketing email. UNIQUE.
 *
 *   aisalesconversations { ownerSessionHash }
 *     A signed-out shopper's own conversations, found by their session.
 *
 * About the unique indexes: each is on a collection 2.4 introduces, so on an
 * upgraded store it is either empty or holds only rows written since the
 * upgrade, and the code that writes them upserts on exactly these keys. If a
 * build fails on a duplicate anyway, the script reports it and carries on with
 * the rest rather than leaving the remaining indexes uncreated; fix the
 * duplicate and run it again.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-store-credit-indexes.mjs            (apply)
 *   node --env-file=.env scripts/migrate-store-credit-indexes.mjs --dry-run  (report only)
 */
const DRY_RUN = process.argv.includes("--dry-run");
// Names and options match what Mongoose derives from the schema, so a later
// autoIndex boot sees them as already present rather than as conflicts.
const ENSURE = [
  [
    "storecredittransactions",
    [
      {
        name: "idempotencyKey_1",
        key: { idempotencyKey: 1 },
        options: { unique: true },
      },
      {
        name: "customerId_1_currency_1_type_1_remaining_1_expiresAt_1",
        key: { customerId: 1, currency: 1, type: 1, remaining: 1, expiresAt: 1 },
      },
      { name: "customerId_1_createdAt_-1", key: { customerId: 1, createdAt: -1 } },
      { name: "orderId_1_type_1", key: { orderId: 1, type: 1 } },
      {
        name: "type_1_status_1_createdAt_1",
        key: { type: 1, status: 1, createdAt: 1 },
      },
      {
        name: "checkoutCartId_1_status_1",
        key: { checkoutCartId: 1, status: 1 },
        options: { sparse: true },
      },
      {
        name: "type_1_expiresAt_1_remaining_1",
        key: { type: 1, expiresAt: 1, remaining: 1 },
      },
    ],
  ],
  [
    "storecreditaccounts",
    [
      {
        name: "customerId_1_currency_1",
        key: { customerId: 1, currency: 1 },
        options: { unique: true },
      },
    ],
  ],
  [
    "orders",
    [
      {
        name: "storeCredit.holdKey_1",
        key: { "storeCredit.holdKey": 1 },
        options: { sparse: true },
      },
      {
        name: "exchangeOf.returnId_1",
        key: { "exchangeOf.returnId": 1 },
        options: { sparse: true },
      },
    ],
  ],
  [
    "marketingsuppressions",
    [{ name: "email_1", key: { email: 1 }, options: { unique: true } }],
  ],
  [
    "aisalesconversations",
    [{ name: "ownerSessionHash_1", key: { ownerSessionHash: 1 } }],
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
        // One duplicate should not cost the store every other index.
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
