import mongoose from "mongoose";

/**
 * Guest customer records migration
 * ================================
 *
 * Guest checkouts now leave an email-keyed customer record behind (the
 * Shopify model): `customerprofiles` rows with `isGuest: true`, an `email`,
 * and no `userId`. Two index changes make that possible, plus one cleanup:
 *
 *   customerprofiles → userId_1 REBUILT as a partial unique index
 *     The old plain unique index stores a null key for every document that
 *     omits `userId`, so the second guest row would collide. The partial
 *     filter { userId: { $type: "objectId" } } keeps uniqueness for real
 *     users while letting any number of guest rows omit the field.
 *
 *   customerprofiles → email_1 (partial unique, isGuest: true)
 *     One guest row per checkout email. Registered rows don't carry `email`
 *     (it lives on the User), so the partial filter keeps them out.
 *
 *   orders → guestEmail_1 (sparse)
 *     Guest orders are looked up by checkout email: the login-time claim
 *     relinks them in one updateMany, and guest stats aggregate over them.
 *
 *   cleanup → phantom customerprofiles
 *     Paid guest orders used to funnel their cart-id customerId into the
 *     stats/loyalty upserts, minting profiles whose userId points at no User.
 *     The admin list counted these but could never display them. They carry
 *     nothing recoverable (no email, no user), so they are deleted.
 *
 * Run AFTER deploying the code whose schema declares the new indexes.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-guest-customer-indexes.mjs            (apply)
 *   node --env-file=.env scripts/migrate-guest-customer-indexes.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

async function listIndexes(collection) {
  try {
    return await collection.indexes();
  } catch {
    // Collection does not exist yet (fresh install) — nothing to migrate.
    return null;
  }
}

async function rebuildProfileUserIdIndex(db) {
  const collection = db.collection("customerprofiles");
  const indexes = await listIndexes(collection);
  if (indexes === null) {
    console.log("   • customerprofiles: collection not found, skipping");
    return;
  }

  const userIdIndex = indexes.find(
    (index) =>
      index.key &&
      Object.keys(index.key).length === 1 &&
      index.key.userId === 1,
  );
  const needsRebuild =
    !userIdIndex || !userIdIndex.partialFilterExpression;

  if (!needsRebuild) {
    console.log("   ✓ customerprofiles.userId_1 already partial");
  } else {
    if (DRY_RUN) {
      console.log(
        `   [dry-run] would ${userIdIndex ? `drop ${userIdIndex.name} and ` : ""}create partial unique customerprofiles.userId_1`,
      );
    } else {
      if (userIdIndex) {
        await collection.dropIndex(userIdIndex.name);
        console.log(`   - dropped customerprofiles.${userIdIndex.name}`);
      }
      await collection.createIndex(
        { userId: 1 },
        {
          name: "userId_1",
          unique: true,
          partialFilterExpression: { userId: { $type: "objectId" } },
        },
      );
      console.log("   + created partial unique customerprofiles.userId_1");
    }
  }

  const emailIndex = indexes.find(
    (index) =>
      index.key &&
      Object.keys(index.key).length === 1 &&
      index.key.email === 1,
  );
  if (emailIndex) {
    console.log("   ✓ customerprofiles.email_1 already present");
  } else if (DRY_RUN) {
    console.log(
      "   [dry-run] would create partial unique customerprofiles.email_1",
    );
  } else {
    await collection.createIndex(
      { email: 1 },
      {
        name: "email_1",
        unique: true,
        partialFilterExpression: { isGuest: true },
      },
    );
    console.log("   + created partial unique customerprofiles.email_1");
  }
}

async function ensureOrderGuestEmailIndex(db) {
  const collection = db.collection("orders");
  const indexes = await listIndexes(collection);
  if (indexes === null) {
    console.log("   • orders: collection not found, skipping");
    return;
  }
  if (indexes.some((index) => index.name === "guestEmail_1")) {
    console.log("   ✓ orders.guestEmail_1 already present");
    return;
  }
  if (DRY_RUN) {
    console.log("   [dry-run] would create sparse orders.guestEmail_1");
    return;
  }
  await collection.createIndex(
    { guestEmail: 1 },
    { name: "guestEmail_1", sparse: true },
  );
  console.log("   + created sparse orders.guestEmail_1");
}

async function deletePhantomProfiles(db) {
  const profiles = db.collection("customerprofiles");
  if ((await listIndexes(profiles)) === null) return;

  // Profiles that claim a userId no User document backs, and that are not
  // guest rows. These are the phantoms the old cart-id stats upserts minted
  // (plus any orphans left by out-of-band user deletions) — invisible to the
  // admin list yet counted in its total.
  const phantomIds = await profiles
    .aggregate([
      { $match: { isGuest: { $ne: true }, userId: { $type: "objectId" } } },
      {
        $lookup: {
          from: "user",
          localField: "userId",
          foreignField: "_id",
          as: "user",
          pipeline: [{ $project: { _id: 1 } }],
        },
      },
      { $match: { user: { $size: 0 } } },
      { $project: { _id: 1 } },
    ])
    .toArray();

  if (phantomIds.length === 0) {
    console.log("   ✓ no phantom profiles found");
    return;
  }
  if (DRY_RUN) {
    console.log(
      `   [dry-run] would delete ${phantomIds.length} phantom profile(s) whose userId matches no user`,
    );
    return;
  }
  const result = await profiles.deleteMany({
    _id: { $in: phantomIds.map((doc) => doc._id) },
  });
  console.log(`   - deleted ${result.deletedCount} phantom profile(s)`);
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
      `\n📇 Guest customer migration${DRY_RUN ? " (DRY RUN)" : ""}...\n`,
    );

    console.log("-- customerprofiles indexes --");
    await rebuildProfileUserIdIndex(db);
    console.log("-- orders indexes --");
    await ensureOrderGuestEmailIndex(db);
    console.log("-- phantom profile cleanup --");
    await deletePhantomProfiles(db);

    console.log(
      `\n✅ Migration ${DRY_RUN ? "dry-run complete (no changes made)" : "completed"}.\n`,
    );
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log("✓ Disconnected from MongoDB");
  }
}

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
