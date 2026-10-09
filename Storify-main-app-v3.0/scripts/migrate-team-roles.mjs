import mongoose from "mongoose";

/**
 * Team roles migration
 * ====================
 *
 * Two one-time repairs behind the admin Team page (multiple administrators,
 * one protected Owner):
 *
 * 1. **`seller` → `staff`.** "seller" was the original name of the staff role
 *    and survives only on accounts created before the rename — every guard
 *    reads both spellings, so nothing is broken, but the UI says Staff and the
 *    data should too. Rewrites `role` and the `roles` array on those accounts.
 *
 * 2. **Owner backfill.** The Owner is the administrator whose AdminProfile
 *    carries `isSuperAdmin` — the install wizard stamps the first admin, but
 *    stores that predate the wizard (or were seeded by hand) may have no such
 *    row. The Team guards protect the Owner from demotion, suspension and
 *    removal; with nobody stamped, the fallback "keep at least one active
 *    administrator" rule is all that guards the store. Designates the OLDEST
 *    active administrator as Owner, creating their AdminProfile if they have
 *    none. Skipped entirely when any owner already exists.
 *
 * Both steps are idempotent.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-team-roles.mjs            (apply)
 *   node --env-file=.env scripts/migrate-team-roles.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Pass --env-file=.env");
    throw new Error("Missing MONGODB_URI");
  }

  console.log(
    `\nTeam roles migration${DRY_RUN ? " (dry run — no changes)" : ""}\n`,
  );

  await mongoose.connect(uri);
  console.log(
    `✓ Connected to ${mongoose.connection.host}/${mongoose.connection.name}`,
  );

  try {
    const db = mongoose.connection.db;
    const users = db.collection("user");
    const adminProfiles = db.collection("adminprofiles");

    // --- 1. seller → staff -------------------------------------------------
    const sellerFilter = { $or: [{ role: "seller" }, { roles: "seller" }] };
    const sellers = await users
      .find(sellerFilter, { projection: { email: 1, role: 1, roles: 1 } })
      .toArray();

    if (sellers.length === 0) {
      console.log("1. seller → staff: nothing to do.");
    } else {
      console.log(`1. seller → staff: ${sellers.length} account(s):`);
      for (const user of sellers) {
        console.log(`   ${user.email || user._id} — role=${user.role}`);
      }
      if (!DRY_RUN) {
        for (const user of sellers) {
          const roles = Array.isArray(user.roles)
            ? user.roles.map((role) => (role === "seller" ? "staff" : role))
            : ["staff"];
          await users.updateOne(
            { _id: user._id },
            {
              $set: {
                ...(user.role === "seller" ? { role: "staff" } : {}),
                roles: Array.from(new Set(roles)),
                updatedAt: new Date(),
              },
            },
          );
        }
        console.log(`   ✅ Rewrote ${sellers.length} account(s).`);
      }
    }

    // --- 2. Owner backfill -------------------------------------------------
    const existingOwner = await adminProfiles.findOne(
      { isSuperAdmin: true },
      { projection: { userId: 1 } },
    );

    if (existingOwner) {
      const ownerUser = await users.findOne(
        { _id: existingOwner.userId },
        { projection: { email: 1 } },
      );
      console.log(
        `2. Owner backfill: already designated (${ownerUser?.email || existingOwner.userId}).`,
      );
    } else {
      const oldestAdmin = await users
        .find(
          {
            $and: [
              { $or: [{ role: "admin" }, { roles: "admin" }] },
              {
                $or: [
                  { status: "active" },
                  { status: { $exists: false } },
                  { status: null },
                ],
              },
            ],
          },
          { projection: { email: 1, createdAt: 1 } },
        )
        .sort({ createdAt: 1 })
        .limit(1)
        .next();

      if (!oldestAdmin) {
        console.log(
          "2. Owner backfill: no active administrator found — run `pnpm create-admin <email>` first.",
        );
      } else {
        console.log(
          `2. Owner backfill: designating ${oldestAdmin.email || oldestAdmin._id} (oldest active admin) as owner.`,
        );
        if (!DRY_RUN) {
          const now = new Date();
          await adminProfiles.updateOne(
            { userId: oldestAdmin._id },
            {
              $set: { isSuperAdmin: true, updatedAt: now },
              $setOnInsert: {
                userId: oldestAdmin._id,
                permissions: [],
                createdAt: now,
              },
            },
            { upsert: true },
          );
          console.log("   ✅ Owner designated.");
        }
      }
    }

    if (DRY_RUN) {
      console.log("\nDry run complete. Re-run without --dry-run to apply.");
    }
  } catch (error) {
    console.error("\n❌ Team roles migration failed:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log("✓ Disconnected from MongoDB");
  }
}

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
