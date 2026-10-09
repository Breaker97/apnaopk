import mongoose from "mongoose";

/**
 * Push subscription migration (native device support)
 * ===================================================
 *
 * `pushsubscriptions` used to hold browser Web Push registrations only, so
 * `endpoint` was a plain unique index. Native app installs now share the
 * collection and have no endpoint at all — and MongoDB treats a *missing*
 * field as null in a unique index. The first native row inserts fine; the
 * second collides with it on `endpoint: null`, so every mobile device after
 * the first fails to register.
 *
 * Mongoose autoIndex creates but never redefines, so deploying the new schema
 * is not enough on an existing database: the old `endpoint_1` stays behind
 * with its original options and keeps rejecting rows (autoIndex just logs an
 * IndexOptionsConflict). This replaces it with the partial equivalent, which
 * only indexes documents that actually carry the field.
 *
 * Mongoose names a single-key index `<field>_1`, so the replacement has the
 * SAME name as the index it supersedes. That rules out the usual
 * create-new-then-drop-old sequence — an index cannot be redefined in place,
 * and creating it under some other name only trips the same conflict once
 * autoIndex asserts the schema's own name. Each stale index is therefore
 * dropped and immediately recreated, and the guard is "is this the
 * non-partial variant?" rather than "does a replacement exist?".
 *
 * Also backfills `platform: "web"` on existing rows so the sender can tell the
 * two kinds apart; a schema default only applies to new documents.
 *
 * Re-run for the mobile app (safe on a database that already had the steps
 * above): every native install registered before installs said which app
 * they are is the shopper app's, so it gets `app: "shop"` — the business app
 * will register its own, and the sender sends a store's own notifications
 * only there. And the `pushtickets` collection gets its TTL index: native
 * pushes waiting for their delivery receipt, kept a day at most.
 *
 * Deployment ordering matters: run this AFTER deploying the code whose schema
 * declares the partial indexes.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-push-subscriptions.mjs            (apply)
 *   node --env-file=.env scripts/migrate-push-subscriptions.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");
const COLLECTION = "pushsubscriptions";

const PARTIAL_INDEXES = [
  {
    name: "endpoint_1",
    key: { endpoint: 1 },
    options: {
      unique: true,
      partialFilterExpression: { endpoint: { $type: "string" } },
    },
  },
  {
    name: "deviceToken_1",
    key: { deviceToken: 1 },
    options: {
      unique: true,
      partialFilterExpression: { deviceToken: { $type: "string" } },
    },
  },
];

/**
 * Indexes an earlier revision of this script created under a "_partial"
 * suffix. They duplicate the key of the schema-named index above, which makes
 * every write maintain two identical B-trees, so clear them out.
 */
const OBSOLETE_INDEX_NAMES = ["endpoint_1_partial", "deviceToken_1_partial"];

async function listIndexes(collection) {
  try {
    return await collection.indexes();
  } catch {
    // Collection does not exist yet (fresh install) — nothing to migrate.
    return null;
  }
}

const TICKETS = "pushtickets";
const TICKET_TTL_SECONDS = 24 * 60 * 60;

async function ensureTicketIndex(db) {
  const tickets = db.collection(TICKETS);
  const existing = (await listIndexes(tickets))?.find((index) => index.name === "createdAt_1");
  if (existing?.expireAfterSeconds === TICKET_TTL_SECONDS) {
    console.log(`   ✓ ${TICKETS}.createdAt_1 already expires after a day`);
    return;
  }
  if (DRY_RUN) {
    console.log(`   [dry-run] would ${existing ? "recreate" : "create"} ${TICKETS}.createdAt_1 (TTL one day)`);
    return;
  }
  if (existing) await tickets.dropIndex("createdAt_1");
  await tickets.createIndex(
    { createdAt: 1 },
    { name: "createdAt_1", expireAfterSeconds: TICKET_TTL_SECONDS },
  );
  console.log(`   + created ${TICKETS}.createdAt_1 (TTL one day)`);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set");
    process.exit(1);
  }

  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME || undefined,
    // This script manages indexes explicitly; do not race with autoIndex.
    autoIndex: false,
  });
  console.log(`Connected${DRY_RUN ? " (dry run)" : ""}\n`);

  const db = mongoose.connection.db;
  const collection = db.collection(COLLECTION);
  const indexes = await listIndexes(collection);

  if (indexes === null) {
    console.log(`   • ${COLLECTION}: collection not found, skipping`);
    await mongoose.disconnect();
    return;
  }

  // 1. Retire duplicates left by an earlier revision of this script.
  for (const name of OBSOLETE_INDEX_NAMES) {
    if (!indexes.some((index) => index.name === name)) continue;
    if (DRY_RUN) {
      console.log(`   [dry-run] would drop obsolete ${COLLECTION}.${name}`);
      continue;
    }
    await collection.dropIndex(name);
    console.log(`   - dropped obsolete ${COLLECTION}.${name}`);
  }

  // 2. Make each unique index partial.
  for (const { name, key, options } of PARTIAL_INDEXES) {
    const existing = indexes.find((index) => index.name === name);

    if (existing?.partialFilterExpression) {
      console.log(`   ✓ ${COLLECTION}.${name} already partial`);
      continue;
    }

    if (existing) {
      if (DRY_RUN) {
        console.log(
          `   [dry-run] would drop and recreate ${COLLECTION}.${name} as partial`,
        );
        continue;
      }
      await collection.dropIndex(name);
      console.log(`   - dropped non-partial ${COLLECTION}.${name}`);
    } else if (DRY_RUN) {
      console.log(`   [dry-run] would create partial ${COLLECTION}.${name}`);
      continue;
    }

    await collection.createIndex(key, { name, ...options });
    console.log(`   + created partial ${COLLECTION}.${name}`);
  }

  // 3. Backfill platform on pre-existing (browser) registrations.
  //    (Native rows always carried one, so they are never caught here.)
  const missingPlatform = await collection.countDocuments({
    platform: { $exists: false },
  });
  if (missingPlatform === 0) {
    console.log(`   ✓ ${COLLECTION}.platform already set on every document`);
  } else if (DRY_RUN) {
    console.log(
      `   [dry-run] would set platform="web" on ${missingPlatform} document(s)`,
    );
  } else {
    const result = await collection.updateMany(
      { platform: { $exists: false } },
      { $set: { platform: "web" } },
    );
    console.log(`   ~ set platform="web" on ${result.modifiedCount} document(s)`);
  }

  // 4. Native installs from before `app` existed are the shopper app's.
  const nativeWithoutApp = {
    platform: { $in: ["ios", "android"] },
    app: { $exists: false },
  };
  const missingApp = await collection.countDocuments(nativeWithoutApp);
  if (missingApp === 0) {
    console.log(`   ✓ ${COLLECTION}.app already set on every app install`);
  } else if (DRY_RUN) {
    console.log(`   [dry-run] would set app="shop" on ${missingApp} app install(s)`);
  } else {
    const result = await collection.updateMany(nativeWithoutApp, {
      $set: { app: "shop" },
    });
    console.log(`   ~ set app="shop" on ${result.modifiedCount} app install(s)`);
  }

  // 5. Push tickets expire a day after the send (Expo keeps receipts that long).
  await ensureTicketIndex(db);

  console.log("\nDone.");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Migration failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
