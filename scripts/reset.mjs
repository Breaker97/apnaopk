import path from "path";
import { readdirSync } from "fs";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

/**
 * Database Reset Script
 *
 * Clears THIS APP's collections, so `db:full-reset` rebuilds a store from
 * nothing but the seed — and leaves anything else in the database alone.
 *
 * Which collections those are is derived from the app's own Mongoose models
 * plus the handful Better Auth owns, never from a list written here. The list
 * used to be written here, and it drifted: every feature that added a
 * collection had to remember to come back, and most did not. It was leaving 29
 * of 74 collections behind — including 89 ledger entries and 18 shipments
 * belonging to orders the reset had just deleted, so a "fresh" store came up
 * with finance data for a catalog that no longer existed.
 *
 * Deriving it from the models fixes that without the opposite risk: a Mongo
 * server usually hosts more than one database and a URI can be pointed at the
 * wrong one, so "delete every collection I can see" is not a safe reading of
 * "reset". Anything this app does not define is reported and left untouched.
 *
 * Documents are DELETED, not dropped: dropping a collection takes its indexes
 * with it, and those are what the `db:migrate` scripts built. A reseeded store
 * has to keep them.
 */

/**
 * Collections Better Auth owns directly through its MongoDB adapter — no
 * Mongoose model registers them, so they cannot be derived. `user` is the
 * exception and comes from the model; the rest are listed because Better Auth
 * is the only thing that writes them.
 */
const AUTH_COLLECTIONS = [
  "account",
  "session",
  "verification",
  "twoFactor",
  "rateLimit",
];

async function resetDatabase() {
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

    console.log("\n🗑️  Starting database reset...\n");

    // Every model FILE, not the `@/models` barrel: the barrel is missing six
    // of them (audit-log, expense, fiscal-period, ai-usage, shipment-job,
    // rate-limit-counter), and a destructive script must not quietly skip a
    // collection because someone added a model without touching an index file.
    // Registering them is what makes their collection names knowable —
    // `Model.collection.name` is Mongoose's own answer, so a custom name
    // (AuditLog → `audit_logs`) and its pluralisation rules are never guessed.
    const modelsDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "models",
    );
    for (const file of readdirSync(modelsDir).filter((name) =>
      name.endsWith(".model.ts"),
    )) {
      await import(path.join(modelsDir, file));
    }
    const owned = new Map();
    for (const model of Object.values(mongoose.models)) {
      owned.set(model.collection.name.toLowerCase(), model.collection.name);
    }
    for (const name of AUTH_COLLECTIONS) owned.set(name.toLowerCase(), name);

    // Matched case-insensitively against what the database actually holds:
    // Better Auth writes camelCase names (`rateLimit`, `twoFactor`) that an
    // exact-match list gets wrong in exactly the way this file already did.
    // Views cannot be written to, and the driver already hides `system.*`.
    const present = (await db.listCollections().toArray())
      .filter((info) => info.type !== "view")
      .map((info) => info.name)
      .sort();
    const COLLECTIONS = present.filter((name) => owned.has(name.toLowerCase()));
    const foreign = present.filter((name) => !owned.has(name.toLowerCase()));

    let totalDropped = 0;

    for (const collectionName of COLLECTIONS) {
      try {
        const result = await db.collection(collectionName).deleteMany({});
        if (result.deletedCount > 0) {
          console.log(
            `   ✓ Cleared ${collectionName} (${result.deletedCount} documents)`,
          );
          totalDropped += result.deletedCount;
        }
      } catch {
        // Collection doesn't exist; safe to skip silently
      }
    }

    if (foreign.length > 0) {
      // Loud on purpose: a collection this app does not define means either a
      // shared database, or a model that was deleted and left its data behind.
      console.log(
        `\n⚠️  Left untouched — not this app's collections (${foreign.length}):`,
      );
      console.log(`   ${foreign.join(", ")}`);
    }

    console.log("\n✅ Database reset completed successfully!\n");
    console.log(`Total documents dropped: ${totalDropped}\n`);
  } catch (error) {
    console.error("\n❌ Database reset failed:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log("✓ Disconnected from MongoDB");
  }
}

resetDatabase()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
