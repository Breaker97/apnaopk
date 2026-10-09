import mongoose from "mongoose";

/**
 * Staff ownership migration
 * =========================
 *
 * `StaffProfile.managedBy` now records who manages a staff member — the
 * platform admin (`"platform"`) or a vendor (`"vendor"`). It used to be
 * inferred from `vendorIds`, but that array is also the data-access scope an
 * admin may grant platform staff ("only see Vendor A's orders"), so scoping a
 * platform staff member to a vendor silently handed them to that vendor's
 * dashboard and made them invisible to the admin.
 *
 * This stamps the field on every profile that predates it, using the same
 * derivation the code's legacy fallback applies at query time: a profile with
 * one or more `vendorIds` was only ever written that way by vendor staff
 * creation, so it is vendor-owned; an empty one is platform-owned. Running the
 * script is therefore a canonicalization, not a behavior change — but do run
 * it, so the fallback branch stops carrying the decision. Idempotent: rows
 * that already have `managedBy` are never touched.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-staff-ownership.mjs            (apply)
 *   node --env-file=.env scripts/migrate-staff-ownership.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Pass --env-file=.env");
    throw new Error("Missing MONGODB_URI");
  }

  console.log(
    `\nStaff ownership migration${DRY_RUN ? " (dry run — no changes)" : ""}\n`,
  );

  await mongoose.connect(uri);
  console.log(
    `✓ Connected to ${mongoose.connection.host}/${mongoose.connection.name}`,
  );

  try {
    const profiles = mongoose.connection.db.collection("staffprofiles");

    const vendorOwnedFilter = {
      managedBy: { $exists: false },
      "vendorIds.0": { $exists: true },
    };
    const platformOwnedFilter = {
      managedBy: { $exists: false },
      "vendorIds.0": { $exists: false },
    };

    const [vendorOwned, platformOwned] = await Promise.all([
      profiles.countDocuments(vendorOwnedFilter),
      profiles.countDocuments(platformOwnedFilter),
    ]);

    if (vendorOwned === 0 && platformOwned === 0) {
      console.log("Nothing to do — every staff profile carries managedBy.");
      return;
    }

    console.log(
      `${platformOwned} profile(s) → managedBy: "platform" (no vendorIds)`,
    );
    console.log(
      `${vendorOwned} profile(s) → managedBy: "vendor" (owned by a vendor)`,
    );

    // Legacy rows a vendor shares are worth knowing about: their permissions
    // and account status are shared across the listed vendors.
    const shared = await profiles.countDocuments({
      ...vendorOwnedFilter,
      "vendorIds.1": { $exists: true },
    });
    if (shared > 0) {
      console.log(
        `  (of which ${shared} belong to more than one vendor — their permissions are shared across those vendors)`,
      );
    }

    if (DRY_RUN) {
      console.log("\nDry run complete. Re-run without --dry-run to apply.");
      return;
    }

    const [vendorResult, platformResult] = await Promise.all([
      profiles.updateMany(vendorOwnedFilter, {
        $set: { managedBy: "vendor", updatedAt: new Date() },
      }),
      profiles.updateMany(platformOwnedFilter, {
        $set: { managedBy: "platform", updatedAt: new Date() },
      }),
    ]);

    console.log(
      `\n✅ Stamped ${platformResult.modifiedCount} platform and ${vendorResult.modifiedCount} vendor profile(s).`,
    );
  } catch (error) {
    console.error("\n❌ Staff ownership migration failed:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log("✓ Disconnected from MongoDB");
  }
}

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
