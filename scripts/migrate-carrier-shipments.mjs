import mongoose from "mongoose";

/**
 * Carrier shipment index migration
 * ================================
 *
 * `Shipment.trackingNumber` was `required` and a component of a plain unique
 * index. A rate-shopped draft has no tracking number yet, so that index had to
 * become PARTIAL — otherwise every draft would collide on null and a sub-order
 * could only ever have one.
 *
 * What it does, in order:
 *   1. Replaces {orderId, vendorId, trackingNumber} with the partial-unique
 *      version filtered on a string trackingNumber. Duplicates are scanned
 *      BEFORE dropping: if any exist the replace is skipped and reported,
 *      rather than leaving the collection with no uniqueness guarantee at all.
 *   2. Replaces {orderId, subOrderId, provider} with a partial-unique version.
 *      It shipped non-unique, so the rate-shopping upsert had nothing enforcing
 *      one draft per parcel per carrier. Same duplicate scan first.
 *   3. Creates the provider lookup indexes and the tracking-poll index.
 *   4. Creates the shipmentjobs indexes (the queue's claim, idempotency and
 *      TTL indexes) so the first cron run does not table-scan.
 *
 * Deployment ordering: run AFTER deploying the code that changed the schemas.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-carrier-shipments.mjs
 *   node --env-file=.env scripts/migrate-carrier-shipments.mjs --dry-run
 */

const DRY_RUN = process.argv.includes("--dry-run");

const LEGACY_UNIQUE = "orderId_1_vendorId_1_trackingNumber_1";
const SUBORDER_PROVIDER = "orderId_1_subOrderId_1_provider_1";

const ENSURE = {
  shipments: [
    {
      name: SUBORDER_PROVIDER,
      key: { orderId: 1, subOrderId: 1, provider: 1 },
      options: {
        unique: true,
        partialFilterExpression: { provider: { $type: "string" } },
      },
    },
    {
      name: "provider_1_providerTransactionId_1",
      key: { provider: 1, providerTransactionId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { providerTransactionId: { $type: "string" } },
      },
    },
    {
      name: "provider_1_providerShipmentId_1",
      key: { provider: 1, providerShipmentId: 1 },
      options: {
        partialFilterExpression: { providerShipmentId: { $type: "string" } },
      },
    },
    { name: "status_1_lastSyncedAt_1", key: { status: 1, lastSyncedAt: 1 } },
  ],
  shipmentjobs: [
    {
      name: "orderId_1_subOrderId_1_shipmentId_1_kind_1",
      key: { orderId: 1, subOrderId: 1, shipmentId: 1, kind: 1 },
      options: { unique: true },
    },
    {
      name: "status_1_nextAttemptAt_1_leaseUntil_1",
      key: { status: 1, nextAttemptAt: 1, leaseUntil: 1 },
    },
    {
      name: "expiresAt_1",
      key: { expiresAt: 1 },
      options: { expireAfterSeconds: 0 },
    },
  ],
};

async function listIndexes(collection) {
  try {
    return await collection.indexes();
  } catch {
    return null; // collection doesn't exist yet (fresh install)
  }
}

/** Shipments that would violate the partial-unique index once it is rebuilt. */
async function findDuplicateTracking(collection) {
  return collection
    .aggregate([
      { $match: { trackingNumber: { $type: "string" } } },
      {
        $group: {
          _id: {
            orderId: "$orderId",
            vendorId: "$vendorId",
            trackingNumber: "$trackingNumber",
          },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 5 },
    ])
    .toArray();
}

async function replaceLegacyUniqueIndex(db) {
  const collection = db.collection("shipments");
  const indexes = await listIndexes(collection);
  if (indexes === null) {
    console.log("   • shipments: collection not found, skipping");
    return false;
  }

  const existing = indexes.find((index) => index.name === LEGACY_UNIQUE);
  const alreadyPartial = Boolean(existing?.partialFilterExpression);

  if (existing && !alreadyPartial) {
    const duplicates = await findDuplicateTracking(collection);
    if (duplicates.length > 0) {
      console.warn(
        `   ! SKIP replace shipments.${LEGACY_UNIQUE}: duplicate {orderId, vendorId, trackingNumber} rows exist (${duplicates.length}+).\n     Resolve them and re-run; keeping the existing index.`,
      );
      return true;
    }
    if (DRY_RUN) {
      console.log(
        `   [dry-run] would replace shipments.${LEGACY_UNIQUE} with a partial-unique index`,
      );
      return true;
    }
    await collection.dropIndex(LEGACY_UNIQUE);
    console.log(`   - dropped shipments.${LEGACY_UNIQUE} (being replaced)`);
  } else if (alreadyPartial) {
    console.log(`   ✓ shipments.${LEGACY_UNIQUE} is already partial`);
    return true;
  }

  if (DRY_RUN) {
    console.log(`   [dry-run] would create shipments.${LEGACY_UNIQUE} (partial)`);
    return true;
  }

  try {
    await collection.createIndex(
      { orderId: 1, vendorId: 1, trackingNumber: 1 },
      {
        name: LEGACY_UNIQUE,
        unique: true,
        partialFilterExpression: { trackingNumber: { $type: "string" } },
      },
    );
    console.log(`   + created shipments.${LEGACY_UNIQUE} (partial unique)`);
  } catch (error) {
    console.warn(
      `   ! FAILED to create shipments.${LEGACY_UNIQUE}: ${error.message}`,
    );
  }
  return true;
}

/** Drafts that would violate the sub-order/provider unique index. */
async function findDuplicateSubOrderProvider(collection) {
  return collection
    .aggregate([
      { $match: { provider: { $type: "string" } } },
      {
        $group: {
          _id: {
            orderId: "$orderId",
            subOrderId: "$subOrderId",
            provider: "$provider",
          },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 5 },
    ])
    .toArray();
}

/**
 * Make {orderId, subOrderId, provider} unique.
 *
 * It shipped non-unique while the comment beside it claimed otherwise, so the
 * rate-shopping upsert had nothing enforcing "one draft per parcel per carrier"
 * — two racing lookups could both insert. Dropping it here lets `ensureIndexes`
 * recreate it with the partial-unique options; a duplicate found first means the
 * existing index is left alone and reported, exactly as the legacy replace does.
 */
async function replaceSubOrderProviderIndex(db) {
  const collection = db.collection("shipments");
  const indexes = await listIndexes(collection);
  if (indexes === null) return;

  const existing = indexes.find((index) => index.name === SUBORDER_PROVIDER);
  if (!existing) return;
  if (existing.unique) {
    console.log(`   ✓ shipments.${SUBORDER_PROVIDER} is already unique`);
    return;
  }

  const duplicates = await findDuplicateSubOrderProvider(collection);
  if (duplicates.length > 0) {
    console.warn(
      `   ! SKIP replace shipments.${SUBORDER_PROVIDER}: duplicate {orderId, subOrderId, provider} rows exist (${duplicates.length}+).\n     Keep the newest of each set — the older ones are abandoned drafts — then re-run.`,
    );
    return;
  }

  if (DRY_RUN) {
    console.log(
      `   [dry-run] would replace shipments.${SUBORDER_PROVIDER} with a partial-unique index`,
    );
    return;
  }

  await collection.dropIndex(SUBORDER_PROVIDER);
  console.log(`   - dropped shipments.${SUBORDER_PROVIDER} (being replaced)`);

  // Built here rather than left to `ensureIndexes`, so that a failure can put
  // the old index back. Between the drop above and the build below the key is
  // unindexed, and a duplicate written in that window fails the build — which
  // would otherwise leave the collection with NO index on
  // {orderId, subOrderId, provider} at all. That index backs the "does this
  // parcel already have a shipment?" lookup on every rate call and every
  // purchase, so losing it is worse than not having the uniqueness.
  try {
    await collection.createIndex(
      { orderId: 1, subOrderId: 1, provider: 1 },
      {
        name: SUBORDER_PROVIDER,
        unique: true,
        partialFilterExpression: { provider: { $type: "string" } },
      },
    );
    console.log(`   + created shipments.${SUBORDER_PROVIDER} (partial unique)`);
  } catch (error) {
    console.warn(
      `   ! FAILED to create shipments.${SUBORDER_PROVIDER} as unique: ${error.message}`,
    );
    await collection.createIndex(
      { orderId: 1, subOrderId: 1, provider: 1 },
      { name: SUBORDER_PROVIDER },
    );
    console.warn(
      `   ↩ restored the non-unique index. Resolve the duplicate rows and re-run;\n     queries are unaffected meanwhile, only the uniqueness guarantee is missing.`,
    );
  }
}

async function ensureIndexes(db, collectionName) {
  const collection = db.collection(collectionName);
  const indexes = await listIndexes(collection);
  const byName = new Map((indexes || []).map((index) => [index.name, index]));

  for (const { name, key, options } of ENSURE[collectionName] || []) {
    if (byName.has(name)) {
      console.log(`   ✓ ${collectionName}.${name} already present`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`   [dry-run] would create ${collectionName}.${name}`);
      continue;
    }
    try {
      await collection.createIndex(key, { name, ...(options || {}) });
      console.log(`   + created ${collectionName}.${name}`);
    } catch (error) {
      console.warn(
        `   ! FAILED to create ${collectionName}.${name}: ${error.message}`,
      );
    }
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
      `\n📦 Carrier shipment index migration${DRY_RUN ? " (DRY RUN)" : ""}...\n`,
    );

    console.log("-- shipments --");
    const exists = await replaceLegacyUniqueIndex(db);
    if (exists) {
      // Before `ensureIndexes`, which creates by name and would otherwise see
      // the old non-unique index still sitting there and skip it.
      await replaceSubOrderProviderIndex(db);
      await ensureIndexes(db, "shipments");
    }

    console.log("-- shipmentjobs --");
    await ensureIndexes(db, "shipmentjobs");

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
