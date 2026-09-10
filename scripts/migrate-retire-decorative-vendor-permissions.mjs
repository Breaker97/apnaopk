import mongoose from "mongoose";

/**
 * Retire the eleven decorative vendor permissions
 * ==============================================
 *
 * `create/edit/delete_analytics`, `create/delete_store_settings`,
 * `create/edit/delete_payouts` and `create/edit/delete_pos` were never required
 * by any guard — problem P4 in docs/VENDOR_PERMISSIONS_GUIDELINE.md. They are
 * now gone from `VENDOR_PERMISSIONS`, so this clears them out of the data.
 *
 * WHY THIS CANNOT BE A PLAIN $pull. They were not inert. The implication table
 * let a decorative permission SATISFY a real one — holding `create_pos` made an
 * `access_pos` guard pass — so a vendor who holds the verb but not its parent
 * loses real access the moment the verb disappears. Every such holding is
 * promoted to the parent first. Same in reverse for revokes: a revoke cascaded
 * up to whatever would otherwise have satisfied it, so a revoke that used to
 * take the umbrella down with it has to keep doing that.
 *
 * The two promotion tables differ, and the difference is not an oversight:
 *
 *   GRANT side  — every verb satisfied its resource's narrowest survivor, so a
 *                 held verb becomes that survivor (`view_*`, or `access_pos`).
 *
 *   REVOKE side — only where the cascade actually reached a survivor. Revoking
 *                 `create_payouts` also killed `manage_payouts`, so that revoke
 *                 is preserved as a revoke of `manage_payouts`. Revoking
 *                 `create_analytics` or `create_pos` killed nothing else (their
 *                 resources have no umbrella above the verb), so those revokes
 *                 are simply dropped — promoting them to `view_analytics` or
 *                 `access_pos` would REMOVE access the vendor has today.
 *
 * Handles both shapes a vendor can be in: the legacy `permissions` array, and
 * `permissionOverrides` for rows already on the derived model.
 *
 * Idempotent: a second run finds nothing to change. Safe to run before or after
 * migrate-vendor-permission-overrides.mjs — that script promotes the same way.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-retire-decorative-vendor-permissions.mjs            (apply)
 *   node --env-file=.env scripts/migrate-retire-decorative-vendor-permissions.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

/** Held verb → the surviving permission it used to satisfy. */
const GRANT_PROMOTIONS = {
  create_analytics: "view_analytics",
  edit_analytics: "view_analytics",
  delete_analytics: "view_analytics",
  create_store_settings: "view_store_settings",
  delete_store_settings: "view_store_settings",
  create_payouts: "view_payouts",
  edit_payouts: "view_payouts",
  delete_payouts: "view_payouts",
  create_pos: "access_pos",
  edit_pos: "access_pos",
  delete_pos: "access_pos",
};

/**
 * Revoked verb → the surviving permission the revoke cascade also took down.
 * Absent means the revoke reached nothing that survives, so it is dropped.
 */
const REVOKE_PROMOTIONS = {
  create_store_settings: "manage_store_settings",
  delete_store_settings: "manage_store_settings",
  create_payouts: "manage_payouts",
  edit_payouts: "manage_payouts",
  delete_payouts: "manage_payouts",
};

const RETIRED = Object.keys(GRANT_PROMOTIONS);

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

    const vendors = await db
      .collection("vendors")
      .find(
        {
          $or: [
            { permissions: { $in: RETIRED } },
            { "permissionOverrides.permission": { $in: RETIRED } },
          ],
        },
        {
          projection: {
            _id: 1,
            storeName: 1,
            permissions: 1,
            permissionOverrides: 1,
          },
        },
      )
      .toArray();

    let updated = 0;
    let promotedGrants = 0;
    let promotedRevokes = 0;
    let droppedRevokes = 0;

    for (const vendor of vendors) {
      const update = {};
      const notes = [];

      // ------------------------------------------------ legacy grant list
      if (Array.isArray(vendor.permissions)) {
        const held = new Set(vendor.permissions);
        const retiredHeld = vendor.permissions.filter((permission) =>
          RETIRED.includes(permission),
        );

        for (const permission of retiredHeld) {
          const parent = GRANT_PROMOTIONS[permission];
          if (!held.has(parent)) {
            held.add(parent);
            promotedGrants += 1;
            notes.push(`${permission} → ${parent}`);
          }
        }
        for (const permission of RETIRED) held.delete(permission);

        const next = Array.from(held);
        if (next.length !== vendor.permissions.length || retiredHeld.length) {
          update.permissions = next;
        }
      }

      // ------------------------------------------------------- overrides
      if (Array.isArray(vendor.permissionOverrides)) {
        const byPermission = new Map(
          vendor.permissionOverrides.map((override) => [
            override.permission,
            override,
          ]),
        );
        let touched = false;

        for (const override of vendor.permissionOverrides) {
          if (!RETIRED.includes(override.permission)) continue;
          touched = true;
          byPermission.delete(override.permission);

          const parent =
            override.mode === "grant"
              ? GRANT_PROMOTIONS[override.permission]
              : REVOKE_PROMOTIONS[override.permission];

          if (!parent) {
            droppedRevokes += 1;
            notes.push(`${override.mode} ${override.permission} → dropped`);
            continue;
          }
          // An existing override on the parent already says what the admin
          // wants; the retired row cannot outrank it.
          if (byPermission.has(parent)) {
            notes.push(
              `${override.mode} ${override.permission} → ${parent} (already set)`,
            );
            continue;
          }

          byPermission.set(parent, {
            ...override,
            permission: parent,
            reason:
              override.reason ||
              `Promoted from the retired ${override.permission}`,
          });
          if (override.mode === "grant") promotedGrants += 1;
          else promotedRevokes += 1;
          notes.push(`${override.mode} ${override.permission} → ${parent}`);
        }

        if (touched) {
          update.permissionOverrides = Array.from(byPermission.values());
        }
      }

      if (Object.keys(update).length === 0) continue;

      console.log(
        `  ${vendor.storeName ?? vendor._id}: ${notes.join(", ") || "cleared"}`,
      );
      if (!DRY_RUN) {
        await db
          .collection("vendors")
          .updateOne({ _id: vendor._id }, { $set: update });
      }
      updated += 1;
    }

    console.log("");
    console.log(DRY_RUN ? "DRY RUN — nothing written" : "Applied");
    console.log(`  vendors touched:      ${updated}`);
    console.log(`  grants promoted:      ${promotedGrants}`);
    console.log(`  revokes promoted:     ${promotedRevokes}`);
    console.log(`  revokes dropped:      ${droppedRevokes}`);
    if (updated === 0) {
      console.log("  (nothing to do — no vendor holds a retired permission)");
    }
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
