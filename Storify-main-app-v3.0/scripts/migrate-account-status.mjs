import mongoose from "mongoose";

/**
 * Account status migration (auth hardening)
 * =========================================
 *
 * `user.status` is now enforced for every role: a `banned` or `inactive`
 * account is refused a session whether it belongs to a shopper, a vendor, a
 * staff member, or an administrator. Previously the check covered only
 * customers and vendors, so for admin/staff/seller accounts the field was
 * written but never read.
 *
 * That is the problem this migration solves. Because nothing enforced the value
 * for those roles, whatever it holds today cannot be read as a deliberate
 * "deny this person" decision — it may be a leftover from an import, an early
 * seed, or a stray edit. Enforcing it retroactively would lock the store's own
 * administrators out of the dashboard on upgrade.
 *
 * So this runs once, at upgrade time: every admin / staff / seller account that
 * is not `active` is set back to `active`. From then on the field means what it
 * says, and deactivating a staff member genuinely ends their access.
 *
 * Customers and vendors are left untouched — the flag was already enforced for
 * them, so their values are intentional.
 *
 * Locked out already? `pnpm create-admin <email>` reactivates and re-promotes a
 * single account without touching anything else.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-account-status.mjs            (apply)
 *   node --env-file=.env scripts/migrate-account-status.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

// Roles whose `status` was never enforced before this release.
const PREVIOUSLY_UNENFORCED_ROLES = ["admin", "staff", "seller"];
const ACTIVE = "active";

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Pass --env-file=.env");
    throw new Error("Missing MONGODB_URI");
  }

  console.log(
    `\nAccount status migration${DRY_RUN ? " (dry run — no changes)" : ""}\n`,
  );

  await mongoose.connect(uri);
  console.log("✓ Connected to MongoDB");

  try {
    const db = mongoose.connection.db;
    const users = db.collection("user");

    // Match on either the primary role or the roles array, so an account that
    // carries admin only in `roles` is covered too.
    const filter = {
      status: { $ne: ACTIVE },
      $or: [
        { role: { $in: PREVIOUSLY_UNENFORCED_ROLES } },
        { roles: { $in: PREVIOUSLY_UNENFORCED_ROLES } },
      ],
    };

    const affected = await users
      .find(filter, { projection: { email: 1, role: 1, roles: 1, status: 1 } })
      .toArray();

    if (affected.length === 0) {
      console.log("Nothing to do — no admin/staff/seller account is inactive.");
      return;
    }

    console.log(
      `${affected.length} account(s) would be reactivated:` +
        (DRY_RUN ? "" : " reactivating now."),
    );
    for (const user of affected) {
      console.log(
        `  ${user.email || user._id} — role=${user.role} status=${user.status} → ${ACTIVE}`,
      );
    }

    if (DRY_RUN) {
      console.log("\nDry run complete. Re-run without --dry-run to apply.");
      return;
    }

    const result = await users.updateMany(filter, {
      $set: { status: ACTIVE, updatedAt: new Date() },
    });
    console.log(`\n✅ Reactivated ${result.modifiedCount} account(s).`);
  } catch (error) {
    console.error("\n❌ Account status migration failed:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log("✓ Disconnected from MongoDB");
  }
}

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
