import crypto from "crypto";
import mongoose from "mongoose";

/**
 * Marketing consent migration
 * ===========================
 *
 * "Email me with news and offers" used to be one boolean on the customer
 * record: `marketingOptIn`. It could not say when the shopper agreed, how, or
 * from where, and it could not tell a shopper who unsubscribed from one who
 * was never asked — so their next order quietly re-subscribed them.
 *
 * Consent is now a record per channel (`emailMarketing`, `smsMarketing`) with
 * a state, an opt-in level, a timestamp and a source, plus the token behind
 * the unsubscribe link. This migration writes those for the rows that predate
 * them:
 *
 *   marketingOptIn: true  → emailMarketing.state = "subscribed",
 *                           optInLevel = "unknown" (nobody recorded how),
 *                           source = "import", consentUpdatedAt = the row's
 *                           own updatedAt (the closest honest date we have),
 *                           and a fresh unsubscribeToken.
 *   marketingOptIn: false → emailMarketing.state = "not_subscribed".
 *
 * Nothing is overwritten: a row that already has `emailMarketing.state` is
 * left exactly as it is, so re-running is safe and a store that upgraded
 * mid-week keeps every consent collected since.
 *
 * The indexes the new queries need (`emailMarketing.state`, the unique
 * partials on `unsubscribeToken` and on a guest row's `phone`) are created
 * here as well, for stores running with MONGODB_AUTO_INDEX=false — and the
 * guest `email_1` index is rebuilt to skip rows that have no email, which a
 * phone-only guest does not.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-marketing-consent.mjs            (apply)
 *   node --env-file=.env scripts/migrate-marketing-consent.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 500;

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function backfillConsent(db) {
  const collection = db.collection("customerprofiles");

  const unwritten = { "emailMarketing.state": { $exists: false } };
  const [subscribers, others] = await Promise.all([
    collection.countDocuments({ ...unwritten, marketingOptIn: true }),
    collection.countDocuments({ ...unwritten, marketingOptIn: { $ne: true } }),
  ]);

  console.log(`   • ${subscribers} subscriber row(s) to convert`);
  console.log(`   • ${others} row(s) to mark as never subscribed`);

  if (DRY_RUN) {
    console.log("   → dry run, writing nothing");
    return;
  }

  // Everyone who never agreed: one flat update, no per-row values needed.
  if (others > 0) {
    const result = await collection.updateMany(
      { ...unwritten, marketingOptIn: { $ne: true } },
      {
        $set: {
          "emailMarketing.state": "not_subscribed",
          "smsMarketing.state": "not_subscribed",
        },
      },
    );
    console.log(`   ✓ ${result.modifiedCount} row(s) marked not_subscribed`);
  }

  // Subscribers carry a date and a token of their own, so they go one at a
  // time, in batches, rather than through one updateMany.
  let converted = 0;
  for (;;) {
    const batch = await collection
      .find({ ...unwritten, marketingOptIn: true })
      .project({ _id: 1, updatedAt: 1, createdAt: 1, unsubscribeToken: 1 })
      .limit(BATCH_SIZE)
      .toArray();
    if (batch.length === 0) break;

    const operations = batch.map((row) => ({
      updateOne: {
        filter: { _id: row._id },
        update: {
          $set: {
            emailMarketing: {
              state: "subscribed",
              // Nothing recorded how these were collected, and guessing
              // "single opt-in" would claim more than the data supports.
              optInLevel: "unknown",
              consentUpdatedAt: row.updatedAt || row.createdAt || new Date(),
              source: "import",
            },
            "smsMarketing.state": "not_subscribed",
            unsubscribeToken: row.unsubscribeToken || newToken(),
          },
        },
      },
    }));

    const result = await collection.bulkWrite(operations, { ordered: false });
    converted += result.modifiedCount ?? 0;
    if (batch.length < BATCH_SIZE) break;
  }
  if (converted > 0) {
    console.log(`   ✓ ${converted} subscriber row(s) converted`);
  }
}

async function ensureIndexes(db) {
  const collection = db.collection("customerprofiles");
  const wanted = [
    {
      name: "emailMarketing.state_1",
      key: { "emailMarketing.state": 1 },
      options: {},
    },
    {
      name: "unsubscribeToken_1",
      key: { unsubscribeToken: 1 },
      options: {
        unique: true,
        partialFilterExpression: { unsubscribeToken: { $type: "string" } },
      },
    },
    {
      // One guest row per phone number, for the shopper who checks out with a
      // number and no email and agrees to be texted.
      name: "phone_1",
      key: { phone: 1 },
      options: {
        unique: true,
        partialFilterExpression: { phone: { $type: "string" }, isGuest: true },
      },
    },
  ];

  let existing = [];
  try {
    existing = await collection.indexes();
  } catch {
    console.log("   • customerprofiles: collection not found, skipping");
    return;
  }

  // The guest email index has to exclude rows with no email, or every
  // phone-only guest indexes as the same null key and the second one is
  // refused. Rebuilt in place where it still carries the old filter.
  const guestEmail = existing.find((index) => index.name === "email_1");
  const needsEmailRebuild =
    guestEmail &&
    !guestEmail.partialFilterExpression?.email;
  if (needsEmailRebuild) {
    if (DRY_RUN) {
      console.log("   → would rebuild email_1 to exclude rows with no email");
    } else {
      await collection.dropIndex("email_1");
      await collection.createIndex(
        { email: 1 },
        {
          name: "email_1",
          unique: true,
          partialFilterExpression: { isGuest: true, email: { $type: "string" } },
        },
      );
      console.log("   ✓ rebuilt email_1 (guest rows with an email only)");
      existing = await collection.indexes();
    }
  }

  for (const index of wanted) {
    const present = existing.some((current) => current.name === index.name);
    if (present) {
      console.log(`   ✓ ${index.name} already present`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`   → would create ${index.name}`);
      continue;
    }
    await collection.createIndex(index.key, {
      name: index.name,
      ...index.options,
    });
    console.log(`   ✓ created ${index.name}`);
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
      `\n📨 Marketing consent migration${DRY_RUN ? " (DRY RUN)" : ""}...\n`,
    );

    console.log("-- consent records --");
    await backfillConsent(db);
    console.log("-- indexes --");
    await ensureIndexes(db);

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
