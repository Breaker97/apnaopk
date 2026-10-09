import mongoose from "mongoose";

/**
 * Index migration for 3.0 (October 2026)
 * ======================================
 *
 * Creates the indexes the shopper app's API relies on. Purely additive:
 * nothing is dropped and nothing is rebuilt, so it is safe to re-run and safe
 * to run on a store that is already up to date.
 *
 * Stores that leave Mongoose `autoIndex` on get both on the next boot. This
 * script exists for deployments running with MONGODB_AUTO_INDEX=false, which
 * is the recommended production setting — there, an index that no migration
 * creates is an index the store never gets. The first two are what stop one
 * tap in the app from placing two orders.
 *
 *   idempotencyrecords { scope, key } unique, { createdAt } TTL one day
 *     The app's Idempotency-Key: one record per key per caller (UNIQUE — a
 *     second request with the same key waits for, or replays, the first),
 *     kept a day.
 *
 *   orders { idempotencyKey } unique partial
 *     The one order an app Idempotency-Key may place. Set only on orders the
 *     app places, which 3.0 introduces, so nothing on an upgraded store can
 *     collide.
 *
 *   coupons { listed, status, endDate }
 *     The shopper app's coupon sheet (GET /coupons): the codes the store chose
 *     to show, still active and not yet ended.
 *
 *   shopperuploads { userId, createdAt: -1 }
 *     A shopper's own photo uploads (reviews, returns, the profile picture),
 *     newest first: the per-shopper upload limit and the ownership check.
 *
 *   The business app's durable operations (a retried write answers the first
 *   one instead of doing it twice):
 *   bizoperations { actorId, key } unique, { state, leaseUntil }
 *     One operation per caller and key; the sweep finds lapsed leases.
 *   orders { bizOperationId } unique partial
 *     The one manual order an operation may place.
 *   paymenttransactions { bizOperationId, bizOperationLeg } unique partial
 *     One payment row per leg of an operation (a refund's gateway leg…).
 *   returnrequests { bizCreateOperationId, bizCreateGroup } unique partial
 *     One return per group of an operation.
 *   bizproductwrites { operationId } unique, { productId }, { createDraftKey } unique sparse
 *     The product editor's write receipts.
 *   bizquotes { tokenHash } unique, { expiresAt }
 *     A manual order's priced quote, by its token.
 *   bizuploadrecords { operationId } unique, { actorId, workspaceId, target.kind, target.id }
 *     The app's uploads, one per operation, and what they belong to.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-mobile-api-indexes.mjs            (apply)
 *   node --env-file=.env scripts/migrate-mobile-api-indexes.mjs --dry-run  (report only)
 */
const DRY_RUN = process.argv.includes("--dry-run");
// Names and options match what Mongoose derives from the schema, so a later
// autoIndex boot sees them as already present rather than as conflicts.
const ENSURE = [
  [
    "idempotencyrecords",
    [
      { name: "scope_1_key_1", key: { scope: 1, key: 1 }, options: { unique: true } },
      {
        name: "createdAt_1",
        key: { createdAt: 1 },
        options: { expireAfterSeconds: 24 * 60 * 60 },
      },
    ],
  ],
  [
    "orders",
    [
      {
        name: "idempotencyKey_1",
        key: { idempotencyKey: 1 },
        options: { unique: true, partialFilterExpression: { idempotencyKey: { $gt: "" } } },
      },
    ],
  ],
  [
    "coupons",
    [{ name: "listed_1_status_1_endDate_1", key: { listed: 1, status: 1, endDate: 1 } }],
  ],
  [
    "shopperuploads",
    [{ name: "userId_1_createdAt_-1", key: { userId: 1, createdAt: -1 } }],
  ],
  [
    "bizoperations",
    [
      { name: "actorId_1_key_1", key: { actorId: 1, key: 1 }, options: { unique: true } },
      { name: "state_1_leaseUntil_1", key: { state: 1, leaseUntil: 1 } },
    ],
  ],
  [
    "orders",
    [
      {
        name: "bizOperationId_1",
        key: { bizOperationId: 1 },
        options: { unique: true, partialFilterExpression: { bizOperationId: { $gt: "" } } },
      },
    ],
  ],
  [
    "paymenttransactions",
    [
      {
        name: "bizOperationId_1_bizOperationLeg_1",
        key: { bizOperationId: 1, bizOperationLeg: 1 },
        options: {
          unique: true,
          partialFilterExpression: { bizOperationId: { $gt: "" }, bizOperationLeg: { $gt: "" } },
        },
      },
    ],
  ],
  [
    "returnrequests",
    [
      {
        name: "bizCreateOperationId_1_bizCreateGroup_1",
        key: { bizCreateOperationId: 1, bizCreateGroup: 1 },
        options: {
          unique: true,
          partialFilterExpression: { bizCreateOperationId: { $gt: "" }, bizCreateGroup: { $gt: "" } },
        },
      },
    ],
  ],
  [
    "bizproductwrites",
    [
      { name: "operationId_1", key: { operationId: 1 }, options: { unique: true } },
      { name: "productId_1", key: { productId: 1 } },
      { name: "createDraftKey_1", key: { createDraftKey: 1 }, options: { unique: true, sparse: true } },
    ],
  ],
  [
    "bizquotes",
    [
      { name: "tokenHash_1", key: { tokenHash: 1 }, options: { unique: true } },
      { name: "expiresAt_1", key: { expiresAt: 1 } },
    ],
  ],
  [
    "bizuploadrecords",
    [
      { name: "operationId_1", key: { operationId: 1 }, options: { unique: true } },
      {
        name: "actorId_1_workspaceId_1_target.kind_1_target.id_1",
        key: { actorId: 1, workspaceId: 1, "target.kind": 1, "target.id": 1 },
      },
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
