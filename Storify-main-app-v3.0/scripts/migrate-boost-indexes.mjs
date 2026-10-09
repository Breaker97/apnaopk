import mongoose from "mongoose";

/**
 * Boost / sponsored-products index migration
 * ==========================================
 *
 * Ensures the indexes the boosting feature declares in its schemas on
 * EXISTING installs (fresh installs get them from Mongoose autoIndex when the
 * collections are first created), and DROPS the two the position ladder made
 * meaningless.
 *
 * Ensured:
 *   boostpositions.position_1 (unique) and {status, position}
 *       the ladder key. Two rows claiming rung 2 would make {position, day}
 *       ambiguous.
 *   boostslotdays.{position,day} and {productId,day} (both unique)
 *       THE constraint. A concurrent double-purchase loses on E11000 instead
 *       of double-booking a rung, and one product never holds two rungs on one
 *       day. Plus {day, position} for the availability calendar and
 *       {campaignId} for every release.
 *   boostcampaigns.{vendorId,createdAt} / {status,createdAt} / {status,endsAt}
 *       vendor list, admin list, cron expiry scan.
 *   platformpayments.reference_1 and each gateway-id key (unique, partial on
 *       $type "string") — the payment-attempt dispatch keys every gateway
 *       completion route resolves by.
 *   boostmetricdailies.campaignId_1_date_1_placement_1 (unique)
 *       the $inc upsert target for impression/click buckets.
 *   platformpayments.stripePaymentIntentId_1
 *       how Stripe's charge.refunded event resolves the paid attempt.
 *
 * Dropped (see DROP below):
 *   boostcampaigns.productId_1 — the one-live-campaign-per-product claim. Under
 *       the ladder a product may legitimately hold this week's Position 1 and
 *       next month's Position 2, and leaving this unique index in place refuses
 *       the second booking with a duplicate-key error nothing explains.
 *   products.sponsorship.active_1_sponsorship.endsAt_1 — the denormalized stamp
 *       is gone; the storefront reads BoostCampaign.
 *
 * Deployment ordering: run AFTER deploying the code whose schemas declare
 * these indexes, like the other index migrations in this directory. The drops
 * are guarded by `requires:` so a half-upgraded install cannot lose the
 * constraint that is still protecting it.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-boost-indexes.mjs            (apply)
 *   node --env-file=.env scripts/migrate-boost-indexes.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

const stringPartial = (field) => ({
  unique: true,
  partialFilterExpression: { [field]: { $type: "string" } },
});

// Names match Mongoose's default naming so these coincide with the
// schema-managed indexes rather than creating duplicates.
const ENSURE = {
  boostpositions: [
    // The ladder key. Two rows claiming rung 2 would make {position, day}
    // ambiguous. Unique across ALL statuses: archiving takes a rung off sale
    // but keeps its number reserved for days already sold on it.
    { name: "position_1", key: { position: 1 }, options: { unique: true } },
    // Query: the admin ladder screen and the vendor catalog both read
    // find({ status: "active" }).sort({ position: 1 }).
    { name: "status_1_position_1", key: { status: 1, position: 1 } },
  ],
  boostslotdays: [
    // THE constraint — a concurrent double-purchase loses on E11000 instead of
    // double-booking the rung.
    {
      name: "position_1_day_1",
      key: { position: 1, day: 1 },
      options: { unique: true },
    },
    // One product may hold different rungs on different days, but never two
    // rungs on the SAME day.
    {
      name: "productId_1_day_1",
      key: { productId: 1, day: 1 },
      options: { unique: true },
    },
    // Query: the availability calendar and the admin occupancy strip.
    // {position, day} cannot serve these — `day` is not its prefix.
    { name: "day_1_position_1", key: { day: 1, position: 1 } },
    // Query: the reservation diff and every release deleteMany.
    { name: "campaignId_1", key: { campaignId: 1 } },
  ],
  boostcampaigns: [
    { name: "vendorId_1_createdAt_-1", key: { vendorId: 1, createdAt: -1 } },
    { name: "status_1_createdAt_-1", key: { status: 1, createdAt: -1 } },
    { name: "status_1_endsAt_1", key: { status: 1, endsAt: 1 } },
    // The cron's own scans. Production commonly runs with autoIndex off, so a
    // schema declaration alone leaves these missing and both passes fall back
    // to a collection scan — every five minutes, forever.
    { name: "status_1_startsAt_1", key: { status: 1, startsAt: 1 } }, // pass 1, activate
    { name: "status_1_holdExpiresAt_1", key: { status: 1, holdExpiresAt: 1 } }, // pass 3, lapsed holds
    // The admin ladder's per-rung campaign lookup.
    { name: "positionId_1_status_1", key: { positionId: 1, status: 1 } },
  ],
  platformpayments: [
    {
      name: "kind_1_campaignId_1_createdAt_-1",
      key: { kind: 1, campaignId: 1, createdAt: -1 },
    },
    {
      name: "kind_1_subscriptionId_1_createdAt_-1",
      key: { kind: 1, subscriptionId: 1, createdAt: -1 },
    },
    {
      name: "kind_1_applicationId_1_createdAt_-1",
      key: { kind: 1, applicationId: 1, createdAt: -1 },
    },
    {
      name: "reference_1",
      key: { reference: 1 },
      options: stringPartial("reference"),
    },
    {
      name: "stripeCheckoutSessionId_1",
      key: { stripeCheckoutSessionId: 1 },
      options: stringPartial("stripeCheckoutSessionId"),
    },
    {
      name: "paypalOrderId_1",
      key: { paypalOrderId: 1 },
      options: stringPartial("paypalOrderId"),
    },
    {
      name: "razorpayOrderId_1",
      key: { razorpayOrderId: 1 },
      options: stringPartial("razorpayOrderId"),
    },
    {
      name: "pesapalOrderTrackingId_1",
      key: { pesapalOrderTrackingId: 1 },
      options: stringPartial("pesapalOrderTrackingId"),
    },
    {
      name: "iotecTransactionId_1",
      key: { iotecTransactionId: 1 },
      options: stringPartial("iotecTransactionId"),
    },
    {
      name: "stripePaymentIntentId_1",
      key: { stripePaymentIntentId: 1 },
      options: stringPartial("stripePaymentIntentId"),
    },
  ],
  boostmetricdailies: [
    {
      name: "campaignId_1_date_1_placement_1",
      key: { campaignId: 1, date: 1, placement: 1 },
      options: { unique: true },
    },
  ],
};

/**
 * Indexes the ladder made meaningless.
 *
 * Each drop is GUARDED by `requires`: an index name that must already exist
 * before the drop is allowed. On a half-upgraded install — new script, old code
 * still running — the replacement constraint is absent, and dropping
 * `boostcampaigns.productId_1` there would remove the only thing stopping a
 * double-boost. The guard makes that ordering impossible to get wrong by hand.
 */
const DROP = {
  boostcampaigns: [
    {
      name: "productId_1",
      // Only once BoostSlotDay carries the real constraint.
      requires: { collection: "boostslotdays", index: "position_1_day_1" },
      why: "one-live-campaign-per-product; the ladder allows several non-overlapping bookings",
    },
  ],
  products: [
    {
      name: "sponsorship.active_1_sponsorship.endsAt_1",
      requires: { collection: "boostslotdays", index: "position_1_day_1" },
      why: "the denormalized Product.sponsorship stamp is deleted",
    },
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

/**
 * Collections whose constraints must exist BEFORE the first write, so the
 * migration creates them rather than skipping.
 *
 * Everything else can be skipped when absent: its indexes are performance
 * hints, and Mongoose builds them when the model is first used. These two are
 * different — `boostslotdays` carries the unique keys that ARE the double-sell
 * guard, and relying on autoIndex to race the first booking is exactly the
 * failure the constraint exists to prevent (autoIndex is also commonly off in
 * production).
 */
const CREATE_IF_MISSING = new Set(["boostpositions", "boostslotdays"]);

async function migrateCollection(db, collectionName) {
  const collection = db.collection(collectionName);
  let existing = await listIndexNames(collection);

  if (existing === null && CREATE_IF_MISSING.has(collectionName)) {
    if (DRY_RUN) {
      console.log(`   [dry-run] would create collection ${collectionName}`);
      existing = new Set();
    } else {
      await db.createCollection(collectionName);
      console.log(`   + created collection ${collectionName}`);
      existing = await listIndexNames(collection);
    }
  }

  if (existing === null) {
    console.log(`   • ${collectionName}: collection not found, skipping`);
    return;
  }

  for (const { name, key, options = {} } of ENSURE[collectionName] || []) {
    if (existing.has(name)) {
      console.log(`   ✓ ${collectionName}.${name} already present`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`   [dry-run] would create ${collectionName}.${name}`);
      continue;
    }
    // background: true keeps a live storefront serving while the index builds.
    await collection.createIndex(key, { name, background: true, ...options });
    existing.add(name);
    console.log(`   + created ${collectionName}.${name}`);
  }
}

async function dropCollection(db, collectionName) {
  const collection = db.collection(collectionName);
  const existing = await listIndexNames(collection);
  if (existing === null) {
    console.log(`   • ${collectionName}: collection not found, skipping`);
    return;
  }

  for (const { name, requires, why } of DROP[collectionName] || []) {
    if (!existing.has(name)) {
      console.log(`   ✓ ${collectionName}.${name} already gone`);
      continue;
    }
    const guardNames = await listIndexNames(db.collection(requires.collection));
    if (!guardNames || !guardNames.has(requires.index)) {
      console.log(
        `   ! ${collectionName}.${name} kept — ${requires.collection}.${requires.index} does not exist yet.`,
      );
      console.log(
        `     Deploy the ladder code and re-run; dropping now would remove the only live constraint.`,
      );
      continue;
    }
    if (DRY_RUN) {
      console.log(`   [dry-run] would drop ${collectionName}.${name} (${why})`);
      continue;
    }
    await collection.dropIndex(name);
    console.log(`   - dropped ${collectionName}.${name} (${why})`);
  }
}

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      // Mirrors lib/db.ts: without this a URI with no path segment silently
      // targets the `test` database and the migration reports "nothing to do".
      ...(process.env.MONGODB_DB_NAME
        ? { dbName: process.env.MONGODB_DB_NAME }
        : {}),
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log("✓ Connected to MongoDB");

    const db = mongoose.connection.db;
    if (!db) {
      console.error("❌ Database connection not available");
      process.exit(1);
    }

    console.log(`\n📇 Boost index migration${DRY_RUN ? " (DRY RUN)" : ""}...\n`);

    // One pass over the UNION: `products` appears only in DROP, so iterating
    // ENSURE alone would never reach it and the stale sponsorship index would
    // survive every run.
    const collections = [
      ...new Set([...Object.keys(ENSURE), ...Object.keys(DROP)]),
    ];
    for (const collectionName of collections) {
      console.log(`-- ${collectionName} --`);
      await migrateCollection(db, collectionName);
      await dropCollection(db, collectionName);
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
