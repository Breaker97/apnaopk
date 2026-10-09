import mongoose from "mongoose";

/**
 * Notification live-poll index migration
 * ======================================
 *
 * The notification surfaces no longer hold an SSE connection open; they poll
 * with a conditional request instead (`hooks/use-live-resource.ts`). Answering
 * "nothing changed" cheaply is the whole point of that change, so
 * GET /api/notifications validates with two indexed reads — this user's
 * document count and their newest `updatedAt` — before deciding whether to run
 * the five queries a full snapshot costs.
 *
 *   notifications             → userId_1_updatedAt_-1  (purely additive)
 *     Serves the validator's sort. The existing { userId, createdAt } index
 *     cannot: `createdAt` never moves when a notification is read or archived,
 *     which are exactly the changes the validator has to notice. Without this
 *     index the sort falls back to scanning the user's whole 30-day window on
 *     every poll — slower than the snapshot it was meant to avoid.
 *
 * Nothing is dropped: every existing index still serves its own query shape.
 * Stores running with MONGODB_AUTO_INDEX left on create this anyway; this
 * script is for the ones that manage indexes explicitly. Run it AFTER
 * deploying the code whose schema declares the index.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-notification-indexes.mjs            (apply)
 *   node --env-file=.env scripts/migrate-notification-indexes.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

const ENSURE = {
  notifications: [
    { name: "userId_1_updatedAt_-1", key: { userId: 1, updatedAt: -1 } },
  ],
};

async function listIndexNames(collection) {
  try {
    const indexes = await collection.indexes();
    return new Set(indexes.map((index) => index.name));
  } catch {
    // Collection does not exist yet (fresh install) — nothing to migrate.
    return null;
  }
}

async function migrateCollection(db, collectionName) {
  const collection = db.collection(collectionName);
  const existing = await listIndexNames(collection);

  if (existing === null) {
    console.log(`   • ${collectionName}: collection not found, skipping`);
    return;
  }

  for (const { name, key } of ENSURE[collectionName] || []) {
    if (existing.has(name)) {
      console.log(`   ✓ ${collectionName}.${name} already present`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`   [dry-run] would create ${collectionName}.${name}`);
      continue;
    }
    await collection.createIndex(key, { name });
    existing.add(name);
    console.log(`   + created ${collectionName}.${name}`);
  }
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
      `\n📇 Notification index migration${DRY_RUN ? " (DRY RUN)" : ""}...\n`,
    );

    for (const collectionName of ["notifications"]) {
      console.log(`-- ${collectionName} --`);
      await migrateCollection(db, collectionName);
    }

    console.log(
      `\n✅ Index migration ${DRY_RUN ? "dry-run complete (no changes made)" : "completed"}.\n`,
    );
  } catch (error) {
    console.error("\n❌ Index migration failed:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log("✓ Disconnected from MongoDB");
  }
}

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
