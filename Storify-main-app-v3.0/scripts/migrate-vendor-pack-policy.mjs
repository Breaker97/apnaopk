import mongoose from "mongoose";

/**
 * Marketplace policy: eight `can*` booleans → one switch per capability pack
 * =========================================================================
 *
 * Guideline §2.8 / problem P5. Policy used to be eight booleans covering eleven
 * packs, so "Manage Store Settings" silently carried Staff and the Inbox with
 * it. It is now `multiVendorMode.packPolicy`, one boolean per pack, so a switch
 * reaches exactly as far as its label.
 *
 * WHY THIS IS OPTIONAL: `readVendorPolicyFlags()` already derives each pack from
 * the boolean it used to sit under, so the split changed nothing on deploy and
 * the app is correct with or without this script. Running it writes the values
 * down, which is what lets an operator move one switch without the other two
 * following along.
 *
 * NOBODY GAINS OR LOSES ACCESS. Every pack is written with exactly what the
 * fallback already resolves it to.
 *
 * THE ONE LOSSY CASE, reported rather than silently resolved: Orders sat under
 * TWO booleans — `canViewOrders` for the list, `canManageOrders` for everything
 * else — which made a marketplace-wide "vendors may look but not touch"
 * possible. One switch per pack cannot express that. Where the two disagree this
 * writes `orders: true` (the reading that takes nothing away) and prints a
 * warning, because the intent is still expressible per vendor: revoke
 * `manage_orders` on the Access tab.
 *
 * Idempotent: a store that already has `packPolicy` is left alone.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-vendor-pack-policy.mjs            (apply)
 *   node --env-file=.env scripts/migrate-vendor-pack-policy.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

// Mirrors LEGACY_POLICY_FLAG_OF_PACK in config/permissions.config.ts.
// Duplicated because migration scripts run as plain ESM without the "@/" alias;
// tests/vendor-permission-packs.test.ts asserts the two stay in step.
const LEGACY_FLAG_OF_PACK = {
  catalog: ["canManageProducts"],
  aiStudio: ["canManageProducts"],
  orders: ["canViewOrders", "canManageOrders"],
  storefront: ["canManageStoreSettings"],
  staff: ["canManageStoreSettings"],
  inbox: ["canManageStoreSettings"],
  analytics: ["canViewAnalytics"],
  discounts: ["canManageDiscounts"],
  boosts: ["canManageDiscounts"],
  payouts: ["canManagePayouts"],
  pos: ["canAccessPOS"],
};

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

    const stores = await db
      .collection("settings")
      .find({}, { projection: { _id: 1, multiVendorMode: 1 } })
      .toArray();

    let updated = 0;
    let skipped = 0;
    let ordersWarnings = 0;

    for (const store of stores) {
      const mv = store.multiVendorMode || {};
      if (mv.packPolicy && typeof mv.packPolicy === "object") {
        skipped += 1;
        continue;
      }

      const packPolicy = {};
      for (const [pack, keys] of Object.entries(LEGACY_FLAG_OF_PACK)) {
        // Absent means allowed: every legacy default was `true`, and a store
        // that never opened the tab must not have its vendors locked out.
        packPolicy[pack] = keys.some((key) => mv[key] ?? true);
      }

      const view = mv.canViewOrders ?? true;
      const manage = mv.canManageOrders ?? true;
      if (view !== manage) {
        ordersWarnings += 1;
        console.log(
          `  ⚠ settings ${store._id}: canViewOrders=${view} but canManageOrders=${manage}.`,
        );
        console.log(
          "    One switch per pack cannot express \"view but not manage\" marketplace-wide.",
        );
        console.log(
          "    Orders is written ON so nothing is taken away; re-create the intent by",
        );
        console.log(
          "    revoking `manage_orders` per vendor on Admin → Vendor → Access.",
        );
      }

      const off = Object.entries(packPolicy)
        .filter(([, on]) => !on)
        .map(([pack]) => pack);
      console.log(
        `  settings ${store._id}: ${11 - off.length}/11 packs on${
          off.length ? ` — off: ${off.join(", ")}` : ""
        }`,
      );

      if (!DRY_RUN) {
        await db
          .collection("settings")
          .updateOne(
            { _id: store._id },
            { $set: { "multiVendorMode.packPolicy": packPolicy } },
          );
      }
      updated += 1;
    }

    console.log("");
    console.log(DRY_RUN ? "DRY RUN — nothing written" : "Applied");
    console.log(`  settings documents written: ${updated}`);
    console.log(`  already had packPolicy:     ${skipped}`);
    console.log(`  orders split warnings:      ${ordersWarnings}`);
    if (updated === 0) {
      console.log("  (nothing to do — already migrated)");
    }
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
