import mongoose from "mongoose";

/**
 * Boost permission backfill
 * =========================
 *
 * Grants `view_boosts` / `manage_boosts` to vendors that already existed before
 * the boosting release.
 *
 * `Vendor.permissions` has `default: DEFAULT_VENDOR_PERMISSIONS`, and a Mongoose
 * array default is MATERIALIZED into each document at creation. Adding new keys
 * to `VENDOR_PERMISSIONS` therefore does nothing for rows that already exist —
 * their persisted array keeps the old list forever, so every pre-existing vendor
 * hits /forbidden on /vendor/boosts and 403s on the boost APIs.
 *
 * Who gets the grant: every vendor that does not already have the keys. That
 * matches what a vendor created TODAY receives — `Vendor.permissions` defaults
 * to the full `DEFAULT_VENDOR_PERMISSIONS` set — so the migration simply brings
 * old rows up to the current default. Revoke per vendor afterwards from the
 * vendor's Access tab if a particular store should not buy boosts.
 *
 * Deliberately NOT heuristic: an earlier draft tried to skip "narrowed" rows by
 * looking for an owner-marker permission, which is exactly the kind of silent
 * partial migration that leaves an operator with a feature that works for some
 * vendors and 403s for others, with no signal that anything was skipped.
 *
 * Idempotent: `$addToSet` never duplicates, and a second run reports 0 changes.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-boost-permissions.mjs            (apply)
 *   node --env-file=.env scripts/migrate-boost-permissions.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

const BOOST_PERMISSIONS = ["view_boosts", "manage_boosts"];

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

    const vendors = db.collection("vendors");

    console.log(
      `\n🔑 Boost permission backfill${DRY_RUN ? " (DRY RUN)" : ""}...\n`,
    );

    const filter = { permissions: { $nin: BOOST_PERMISSIONS } };
    const total = await vendors.countDocuments({});
    const pending = await vendors.countDocuments(filter);

    if (pending === 0) {
      console.log(
        `   ✓ nothing to do — all ${total} vendor row(s) already carry the boost permissions`,
      );
    } else if (DRY_RUN) {
      console.log(
        `   [dry-run] would add ${BOOST_PERMISSIONS.join(", ")} to ${pending} of ${total} vendor row(s)`,
      );
    } else {
      const result = await vendors.updateMany(filter, {
        $addToSet: { permissions: { $each: BOOST_PERMISSIONS } },
      });
      console.log(
        `   + granted ${BOOST_PERMISSIONS.join(", ")} to ${result.modifiedCount} of ${total} vendor row(s)`,
      );
      // $nin matches a row missing EITHER key, and $addToSet fills both, so a
      // second pass must find nothing. Verify rather than assume.
      const remaining = await vendors.countDocuments(filter);
      if (remaining > 0) {
        console.warn(
          `   ! ${remaining} vendor row(s) still lack a boost permission — re-run and investigate`,
        );
      }
    }

    console.log(
      `\n✅ Permission backfill ${DRY_RUN ? "dry-run complete (no changes made)" : "completed"}.\n`,
    );
  } catch (error) {
    console.error("\n❌ Permission backfill failed:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log("✓ Disconnected from MongoDB");
  }
}

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
