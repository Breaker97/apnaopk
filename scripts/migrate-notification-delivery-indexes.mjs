import mongoose from "mongoose";

/**
 * Notification delivery index migration (September 2026)
 * =======================================================
 *
 * Creates the indexes the email and SMS notification outboxes rely on. Purely
 * additive — `smsdeliveries` is a new collection, and `emaildeliveries` only
 * gains one index.
 *
 *   emaildeliveries { dedupeKey } unique, partial
 *   smsdeliveries   { dedupeKey } unique, partial
 *     One email and one text per event per recipient, even when two copies of
 *     the event arrive at the same moment (a carrier webhook racing a
 *     merchant's "mark shipped"). The sender also checks before queueing, so
 *     this only matters for truly concurrent events — but those are the ones
 *     a customer notices, and SMS is billed per message.
 *
 *   smsdeliveries { providerMessageId } unique, partial
 *     How a Twilio delivery receipt finds its message.
 *
 *   smsdeliveries { status, nextAttemptAt, createdAt }
 *     The retry sweep in /api/cron/email-deliveries.
 *
 *   smsdeliveries { createdAt } TTL 90 days, { expiresAt } TTL
 *     Log retention (Settings → SMS → Keep sent logs).
 *
 *   smsdeliveries { to }, { category }
 *     The delivery log's search.
 *
 * Stores that leave Mongoose `autoIndex` on get all of them on the next boot;
 * this script exists for deployments that run with MONGODB_AUTO_INDEX=false.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-notification-delivery-indexes.mjs            (apply)
 *   node --env-file=.env scripts/migrate-notification-delivery-indexes.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

// Names and options match what Mongoose derives from the schema, so a later
// autoIndex boot sees them as already present rather than as conflicts.
const UNIQUE_DEDUPE_KEY = {
  name: "dedupeKey_1",
  key: { dedupeKey: 1 },
  options: {
    unique: true,
    partialFilterExpression: { dedupeKey: { $type: "string" } },
  },
};

const ENSURE_EMAIL = [UNIQUE_DEDUPE_KEY];

const ENSURE_SMS = [
  { name: "to_1", key: { to: 1 } },
  { name: "category_1", key: { category: 1 } },
  {
    name: "status_1_nextAttemptAt_1_createdAt_1",
    key: { status: 1, nextAttemptAt: 1, createdAt: 1 },
  },
  UNIQUE_DEDUPE_KEY,
  {
    name: "providerMessageId_1",
    key: { providerMessageId: 1 },
    options: {
      unique: true,
      partialFilterExpression: { providerMessageId: { $type: "string" } },
    },
  },
  {
    name: "createdAt_1",
    key: { createdAt: 1 },
    options: { expireAfterSeconds: 90 * 24 * 60 * 60 },
  },
  {
    name: "expiresAt_1",
    key: { expiresAt: 1 },
    options: { expireAfterSeconds: 0 },
  },
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
  for (const [collectionName, wanted] of [
    ["emaildeliveries", ENSURE_EMAIL],
    ["smsdeliveries", ENSURE_SMS],
  ]) {
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
      } else {
        await collection.createIndex(key, { name, background: true, ...options });
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
