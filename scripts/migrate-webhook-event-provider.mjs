import mongoose from "mongoose";

/**
 * Webhook event ledger migration
 * ==============================
 *
 * The `webhookevents` collection was Stripe-only and had no retention: every
 * event ever received stayed forever. Carrier tracking webhooks fire once per
 * scan per parcel, which turns that slow leak into a fast one, so the schema
 * now carries an `expiresAt` set on settled rows plus a TTL index.
 *
 * What it does:
 *   1. Creates the { expiresAt: 1 } TTL index (expireAfterSeconds: 0). A null
 *      expiresAt never expires, so in-flight rows are safe.
 *   2. Backfills expiresAt on rows that are already settled (processed or
 *      failed), dated from when they settled so the backlog drains rather than
 *      all expiring 30 days from today.
 *
 * The `provider` enum widening (stripe | shippo | shiprocket) needs no data
 * change — existing rows are all "stripe" and remain valid.
 *
 * Deployment ordering: run AFTER deploying the code that changed the schema.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-webhook-event-provider.mjs
 *   node --env-file=.env scripts/migrate-webhook-event-provider.mjs --dry-run
 */

const DRY_RUN = process.argv.includes("--dry-run");

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TTL_INDEX_NAME = "expiresAt_1";

async function listIndexes(collection) {
  try {
    return await collection.indexes();
  } catch {
    return null; // collection doesn't exist (fresh install)
  }
}

async function ensureTtlIndex(collection) {
  const indexes = await listIndexes(collection);
  if (indexes === null) {
    console.log("   • webhookevents: collection not found, skipping");
    return false;
  }
  const existing = indexes.find((index) => index.name === TTL_INDEX_NAME);
  if (existing) {
    if (existing.expireAfterSeconds === 0) {
      console.log(`   ✓ ${TTL_INDEX_NAME} already present`);
      return true;
    }
    // Mongo will not change expireAfterSeconds in place, so a wrong one must
    // be dropped and rebuilt rather than silently left alone.
    if (DRY_RUN) {
      console.log(`   [dry-run] would replace ${TTL_INDEX_NAME} (wrong TTL)`);
      return true;
    }
    await collection.dropIndex(TTL_INDEX_NAME);
    console.log(`   - dropped ${TTL_INDEX_NAME} (being replaced)`);
  }
  if (DRY_RUN) {
    console.log(`   [dry-run] would create ${TTL_INDEX_NAME}`);
    return true;
  }
  await collection.createIndex(
    { expiresAt: 1 },
    { name: TTL_INDEX_NAME, expireAfterSeconds: 0 },
  );
  console.log(`   + created ${TTL_INDEX_NAME}`);
  return true;
}

async function backfillExpiry(collection) {
  const filter = {
    status: { $in: ["processed", "failed"] },
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }],
  };

  const pending = await collection.countDocuments(filter);
  if (pending === 0) {
    console.log("   ✓ no settled rows are missing expiresAt");
    return;
  }
  if (DRY_RUN) {
    console.log(`   [dry-run] would stamp expiresAt on ${pending} settled rows`);
    return;
  }

  // Dated from when the row settled (processedAt, else updatedAt), so an old
  // backlog expires promptly instead of all living another 30 days.
  const result = await collection.updateMany(filter, [
    {
      $set: {
        expiresAt: {
          $add: [
            { $ifNull: ["$processedAt", { $ifNull: ["$updatedAt", "$$NOW"] }] },
            RETENTION_MS,
          ],
        },
      },
    },
  ]);
  console.log(`   ~ stamped expiresAt on ${result.modifiedCount} settled rows`);
}

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI;
  const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;

  if (!MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      ...(MONGODB_DB_NAME ? { dbName: MONGODB_DB_NAME } : {}),
      maxPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("✓ Connected to MongoDB");

    const db = mongoose.connection.db;
    if (!db) {
      console.error("❌ Database connection not available");
      process.exit(1);
    }

    console.log(
      `\n📇 Webhook event ledger migration${DRY_RUN ? " (DRY RUN)" : ""}...\n`,
    );
    console.log("-- webhookevents --");

    const collection = db.collection("webhookevents");
    const exists = await ensureTtlIndex(collection);
    if (exists) await backfillExpiry(collection);

    console.log(
      `\n✅ Migration ${DRY_RUN ? "dry-run complete (no changes made)" : "completed"}.\n`,
    );
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

run().catch(() => process.exit(1));
