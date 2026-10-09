import mongoose from "mongoose";

/**
 * Audit index migration (orders, returns, payouts, carts, wishlists, …)
 * =====================================================================
 *
 * Brings existing databases in line with the index set defined in the models
 * after the July 2026 architecture/finance audit. Mongoose autoIndex only
 * CREATES indexes — it never drops the stale ones, and in production
 * autoIndex is now disabled entirely, so this script is the way schema index
 * changes reach a live database.
 *
 * What it does, in order:
 *   1. Dedupes wishlists (merges duplicate per-user documents) so the new
 *      unique { userId: 1 } index can be built.
 *   2. Replaces the plain non-unique gateway-reference indexes on orders
 *      (paypalOrderId, razorpayOrderId, paystackReference) with the partial
 *      UNIQUE indexes the schema now declares. Same name, different options —
 *      so the old one must be dropped first. Duplicate values are scanned
 *      BEFORE dropping: if any exist, the replace is skipped (keeping the old
 *      non-unique index) and reported, instead of leaving the field with no
 *      index at all after a failed unique build.
 *   3. Ensures every new index exists (compounds, TTL, partial uniques).
 *   4. Drops superseded single-field indexes, each gated on its superseding
 *      index being present. Nothing is dropped blind.
 *
 * Deployment ordering: run AFTER deploying the code that changed the schemas.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-audit-indexes.mjs            (apply)
 *   node --env-file=.env scripts/migrate-audit-indexes.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

const DAY = 24 * 60 * 60;

// Non-unique indexes that are being REPLACED by a unique/partial index with
// the same name: drop first (if the existing one has different options), then
// the ENSURE step recreates them correctly.
const REPLACE = {
  orders: [
    {
      name: "paypalOrderId_1",
      key: { paypalOrderId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { paypalOrderId: { $gt: "" } },
      },
    },
    {
      name: "razorpayOrderId_1",
      key: { razorpayOrderId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { razorpayOrderId: { $gt: "" } },
      },
    },
    {
      name: "paystackReference_1",
      key: { paystackReference: 1 },
      options: {
        unique: true,
        partialFilterExpression: { paystackReference: { $gt: "" } },
      },
    },
    {
      name: "stripePaymentIntentId_1",
      key: { stripePaymentIntentId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { stripePaymentIntentId: { $gt: "" } },
      },
    },
    {
      name: "stripeSessionId_1",
      key: { stripeSessionId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { stripeSessionId: { $gt: "" } },
      },
    },
    {
      name: "pesapalOrderTrackingId_1",
      key: { pesapalOrderTrackingId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { pesapalOrderTrackingId: { $gt: "" } },
      },
    },
    {
      name: "pesapalMerchantReference_1",
      key: { pesapalMerchantReference: 1 },
      options: {
        unique: true,
        partialFilterExpression: { pesapalMerchantReference: { $gt: "" } },
      },
    },
  ],
  // The TTL index name-collides with the plain lastMessageAt_1 that the old
  // field-level index:true created — same name, different options, so it must
  // be dropped and recreated with expireAfterSeconds (ENSURE's name check
  // would see it as "already present" and silently skip the TTL).
  aisalesconversations: [
    {
      name: "lastMessageAt_1",
      key: { lastMessageAt: 1 },
      options: { expireAfterSeconds: 90 * DAY },
    },
  ],
  // Audit retention was 90 days — shorter than a card chargeback window, and
  // these rows are what the admin order Timeline renders, so an order's whole
  // history vanished while the order was still on file. Mongo will not change
  // expireAfterSeconds on an existing index, so it is dropped and recreated.
  audit_logs: [
    {
      name: "createdAt_1",
      key: { createdAt: 1 },
      options: { expireAfterSeconds: 730 * DAY },
    },
  ],
};

const ENSURE = {
  orders: [
    { name: "status_1_createdAt_-1", key: { status: 1, createdAt: -1 } },
    {
      name: "paymentStatus_1_createdAt_-1",
      key: { paymentStatus: 1, createdAt: -1 },
    },
    {
      name: "customerId_1_createdAt_-1",
      key: { customerId: 1, createdAt: -1 },
    },
    {
      name: "subOrders.vendorId_1_createdAt_-1",
      key: { "subOrders.vendorId": 1, createdAt: -1 },
    },
    {
      name: "channel_1_staffId_1_createdAt_-1",
      key: { channel: 1, staffId: 1, createdAt: -1 },
    },
    {
      name: "posClientRequestId_1",
      key: { posClientRequestId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { posClientRequestId: { $gt: "" } },
      },
    },
  ],
  reviews: [
    {
      name: "isApproved_1_createdAt_-1",
      key: { isApproved: 1, createdAt: -1 },
    },
    { name: "createdAt_-1", key: { createdAt: -1 } },
  ],
  carts: [
    {
      name: "recoveryToken_1",
      key: { recoveryToken: 1 },
      options: { sparse: true },
    },
    {
      name: "status_1_lastActionAt_1",
      key: { status: 1, lastActionAt: 1 },
    },
  ],
  customerprofiles: [{ name: "createdAt_-1", key: { createdAt: -1 } }],
  // Staff comments on an order, read newest-first for the order Timeline.
  ordercomments: [
    {
      name: "orderId_1_createdAt_-1",
      key: { orderId: 1, createdAt: -1 },
    },
  ],
  wishlists: [
    {
      name: "userId_1",
      key: { userId: 1 },
      options: { unique: true },
    },
  ],
};

// Superseded single-field indexes, gated on the superseding index existing.
const DROP = {
  orders: [
    { name: "status_1", requires: ["status_1_createdAt_-1"] },
    { name: "paymentStatus_1", requires: ["paymentStatus_1_createdAt_-1"] },
    { name: "customerId_1", requires: ["customerId_1_createdAt_-1"] },
    {
      name: "subOrders.vendorId_1",
      requires: ["subOrders.vendorId_1_createdAt_-1"],
    },
  ],
  reviews: [{ name: "isApproved_1", requires: ["isApproved_1_createdAt_-1"] }],
  returnrequests: [
    { name: "orderId_1", requires: ["orderId_1_status_1"] },
    { name: "customerId_1", requires: ["customerId_1_createdAt_-1"] },
    { name: "vendorIds_1", requires: ["vendorIds_1_createdAt_-1"] },
    {
      name: "ownerType_1",
      requires: ["ownerType_1_ownerVendorId_1_createdAt_-1"],
    },
  ],
  payouts: [
    { name: "vendorId_1", requires: ["vendorId_1_status_1_createdAt_-1"] },
    { name: "periodStart_1", requires: ["periodStart_1_periodEnd_1"] },
  ],
  paymenttransactions: [
    { name: "type_1", requires: ["type_1_status_1_createdAt_-1"] },
    { name: "vendorId_1", requires: ["vendorId_1_createdAt_-1"] },
  ],
  transfers: [
    { name: "status_1", requires: ["status_1_createdAt_-1"] },
    {
      name: "fromLocationId_1",
      requires: ["fromLocationId_1_toLocationId_1_createdAt_-1"],
    },
  ],
  abandonedcheckouts: [
    {
      name: "recoveryStatus_1",
      requires: ["recoveryStatus_1_recoveryEmailStatus_1"],
    },
    { name: "abandonedAt_1", requires: ["abandonedAt_-1_updatedAt_-1"] },
  ],
  carts: [
    {
      name: "recoveryStatus_1",
      requires: ["recoveryStatus_1_recoveryEmailStatus_1"],
    },
  ],
  emaildeliveries: [
    { name: "status_1", requires: ["status_1_nextAttemptAt_1_createdAt_1"] },
  ],
  pushsubscriptions: [
    { name: "userId_1", requires: ["userId_1_isActive_1_updatedAt_-1"] },
  ],
  blogcomments: [
    { name: "postId_1", requires: ["postId_1_status_1_createdAt_-1"] },
  ],
  blogposts: [{ name: "status_1", requires: ["status_1_publishedAt_-1"] }],
  aisalesconversations: [
    { name: "sessionId_1", requires: ["sessionId_1_updatedAt_-1"] },
  ],
};

async function listIndexes(collection) {
  try {
    return await collection.indexes();
  } catch {
    return null; // collection doesn't exist (fresh install)
  }
}

/**
 * Values that would violate a unique index on `field` (non-empty duplicates,
 * matching the partial index filter `{ $gt: "" }`). Capped at a handful —
 * enough to report examples without scanning everything into memory.
 */
async function findDuplicateNonEmptyValues(collection, field) {
  return collection
    .aggregate([
      { $match: { [field]: { $gt: "" } } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 5 },
    ])
    .toArray();
}

async function dedupeWishlists(db) {
  const collection = db.collection("wishlists");
  const indexes = await listIndexes(collection);
  if (indexes === null) {
    console.log("   • wishlists: collection not found, skipping dedupe");
    return;
  }

  const duplicates = await collection
    .aggregate([
      {
        $group: {
          _id: "$userId",
          ids: { $push: "$_id" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  if (duplicates.length === 0) {
    console.log("   ✓ wishlists: no duplicate userId documents");
    return;
  }

  for (const group of duplicates) {
    if (DRY_RUN) {
      console.log(
        `   [dry-run] would merge ${group.count} wishlists for userId=${group._id}`,
      );
      continue;
    }
    const docs = await collection
      .find({ _id: { $in: group.ids } })
      .sort({ createdAt: 1 })
      .toArray();
    const [keep, ...rest] = docs;
    const seen = new Set(
      (keep.items || []).map((item) => String(item.productId)),
    );
    const mergedItems = [...(keep.items || [])];
    for (const doc of rest) {
      for (const item of doc.items || []) {
        const key = String(item.productId);
        if (!seen.has(key)) {
          seen.add(key);
          mergedItems.push(item);
        }
      }
    }
    await collection.updateOne(
      { _id: keep._id },
      { $set: { items: mergedItems } },
    );
    await collection.deleteMany({
      _id: { $in: rest.map((doc) => doc._id) },
    });
    console.log(
      `   ~ merged ${group.count} wishlists → 1 for userId=${group._id} (${mergedItems.length} items)`,
    );
  }
}

async function migrateCollection(db, collectionName) {
  const collection = db.collection(collectionName);
  const indexes = await listIndexes(collection);
  if (indexes === null) {
    console.log(`   • ${collectionName}: collection not found, skipping`);
    return;
  }
  const byName = new Map(indexes.map((index) => [index.name, index]));

  // 0. Replace same-name indexes whose options changed (plain → partial
  // unique, or plain → TTL).
  for (const { name, key, options } of REPLACE[collectionName] || []) {
    const existing = byName.get(name);
    const wantsUnique = options?.unique === true;
    const needsReplace =
      existing &&
      (wantsUnique
        ? existing.unique !== true
        : options?.expireAfterSeconds !== undefined &&
          existing.expireAfterSeconds !== options.expireAfterSeconds);
    if (needsReplace) {
      // Never drop the old index while duplicates exist: the unique re-create
      // would fail and leave the field with NO index (every lookup on it a
      // collection scan, and no duplicate-order protection either).
      if (wantsUnique) {
        const field = Object.keys(key)[0];
        const duplicates = await findDuplicateNonEmptyValues(collection, field);
        if (duplicates.length > 0) {
          const examples = duplicates.map((dup) => dup._id).join(", ");
          console.warn(
            `   ! SKIP replace ${collectionName}.${name}: duplicate ${field} values exist (e.g. ${examples}).\n     Resolve those documents and re-run; keeping the existing non-unique index.`,
          );
          continue;
        }
      }
      if (DRY_RUN) {
        console.log(
          `   [dry-run] would replace ${collectionName}.${name} (non-unique → partial unique)`,
        );
      } else {
        await collection.dropIndex(name);
        byName.delete(name);
        console.log(`   - dropped ${collectionName}.${name} (being replaced)`);
      }
    }
    if (!byName.has(name)) {
      if (DRY_RUN) {
        console.log(`   [dry-run] would create ${collectionName}.${name}`);
        continue;
      }
      try {
        await collection.createIndex(key, { name, ...(options || {}) });
        byName.set(name, { name, key, ...(options || {}) });
        console.log(`   + created ${collectionName}.${name}`);
      } catch (error) {
        console.warn(
          `   ! FAILED to create ${collectionName}.${name}: ${error.message}\n     (duplicate values probably exist — resolve them and re-run)`,
        );
      }
    }
  }

  // 1. Ensure new indexes.
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
      byName.set(name, { name, key, ...(options || {}) });
      console.log(`   + created ${collectionName}.${name}`);
    } catch (error) {
      console.warn(
        `   ! FAILED to create ${collectionName}.${name}: ${error.message}`,
      );
    }
  }

  // 2. Drop superseded indexes (guarded).
  for (const { name, requires } of DROP[collectionName] || []) {
    if (!byName.has(name)) {
      console.log(`   • ${collectionName}.${name} not present, nothing to drop`);
      continue;
    }
    const missing = requires.filter((req) => !byName.has(req));
    if (missing.length > 0 && !DRY_RUN) {
      console.warn(
        `   ! SKIP drop ${collectionName}.${name}: superseding index missing (${missing.join(", ")})`,
      );
      continue;
    }
    if (DRY_RUN) {
      console.log(
        `   [dry-run] would drop ${collectionName}.${name} (superseded by ${requires.join(", ")})`,
      );
      continue;
    }
    await collection.dropIndex(name);
    byName.delete(name);
    console.log(`   - dropped ${collectionName}.${name}`);
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

    console.log(`\n📇 Audit index migration${DRY_RUN ? " (DRY RUN)" : ""}...\n`);

    console.log("-- wishlists (dedupe) --");
    await dedupeWishlists(db);

    const collections = [
      "orders",
      "reviews",
      "returnrequests",
      "payouts",
      "paymenttransactions",
      "transfers",
      "abandonedcheckouts",
      "carts",
      "emaildeliveries",
      "pushsubscriptions",
      "blogcomments",
      "blogposts",
      "aisalesconversations",
      "customerprofiles",
      "wishlists",
      "audit_logs",
      "ordercomments",
    ];
    for (const collectionName of collections) {
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
  }
}

run().catch(() => process.exit(1));
