import mongoose from "mongoose";

/**
 * Staff role migration (3.1)
 * ==========================
 *
 * In 3.1 every member of the store's own staff has a team role. The built-in
 * Staff role is the one they start on; until now a staff member carried a
 * permission list of their own. This moves each of them onto Staff and keeps
 * their list as changes from it (extras and revokes), so everyone holds
 * exactly what they held before. From then on, editing the Staff role on
 * Team → Roles changes every staff member on it, with their own changes kept.
 *
 * It also retires three Point of Sale strings no guard ever asked for —
 * `create_pos`, `edit_pos`, `delete_pos`. A grant of one becomes `access_pos`
 * (the register, which holding one already opened); a revoke of one reached
 * nothing and is dropped. The app already reads them this way
 * (`RETIRED_STAFF_PERMISSION_GRANTS`); this writes it down.
 *
 * A vendor's own staff are left alone: vendors do not use team roles.
 *
 *   1. teamroles      — the built-in Staff role is made when missing.
 *   2. teamroles, adminprofiles, staffprofiles — retired strings rewritten.
 *   3. staffprofiles  — the store's staff with no role moved onto Staff.
 *
 * Safe to re-run: a staff member who already has a role is skipped, and a
 * list with no retired string is not touched.
 *
 * Usage:
 *   pnpm db:migrate team-staff-role             # apply
 *   pnpm db:migrate team-staff-role --dry-run   # report only
 */

const DRY_RUN = process.argv.includes("--dry-run");

// Kept in step with config/team-permissions.config.ts (BUILT_IN_TEAM_ROLES)
// and config/permissions.config.ts (DEFAULT_STAFF_PERMISSIONS,
// RETIRED_STAFF_PERMISSION_GRANTS); a script cannot import the app's config.
const STAFF_ROLE = {
  key: "staff",
  name: "Staff",
  description: "Sells and helps customers. Starts with the till, orders and the inbox.",
  tier: "staff",
  allPermissions: false,
  permissions: ["access_pos", "view_orders", "view_products", "view_customers", "view_inbox", "reply_inbox"],
  builtIn: true,
};
const RETIRED = { create_pos: "access_pos", edit_pos: "access_pos", delete_pos: "access_pos" };
const STAFF_ROLES = ["staff", "seller"];

const strings = (list) => (Array.isArray(list) ? list.filter((value) => typeof value === "string") : []);
const promote = (list) => Array.from(new Set(strings(list).map((permission) => RETIRED[permission] ?? permission)));
const dropRetired = (list) => strings(list).filter((permission) => !(permission in RETIRED));
const hasRetired = (list) => strings(list).some((permission) => permission in RETIRED);

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI;
  const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;
  if (!MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI, {
    ...(MONGODB_DB_NAME ? { dbName: MONGODB_DB_NAME } : {}),
  });
  const db = mongoose.connection.db;
  console.log(`${DRY_RUN ? "🔍 Dry run" : "🚀 Applying"} on database "${db.databaseName}"`);

  const roles = db.collection("teamroles");
  const adminProfiles = db.collection("adminprofiles");
  const staffProfiles = db.collection("staffprofiles");
  const users = db.collection("user");

  // 1. The built-in Staff role.
  let staffRole = await roles.findOne({ key: STAFF_ROLE.key });
  if (staffRole && staffRole.tier !== "staff") {
    console.error(`❌ A role with the key "${STAFF_ROLE.key}" exists for the admin dashboard; rename its key and re-run.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  if (!staffRole) {
    if (DRY_RUN) {
      console.log("  + would create the built-in Staff role");
      staffRole = { _id: null, ...STAFF_ROLE };
    } else {
      const now = new Date();
      const inserted = await roles.insertOne({ ...STAFF_ROLE, createdAt: now, updatedAt: now });
      staffRole = { _id: inserted.insertedId, ...STAFF_ROLE };
      console.log("  + created the built-in Staff role");
    }
  } else {
    console.log("  = the built-in Staff role is already there");
  }

  // 2. Retired Point of Sale strings.
  let rewritten = 0;
  for await (const role of roles.find({ permissions: { $in: Object.keys(RETIRED) } })) {
    rewritten += 1;
    if (!DRY_RUN) await roles.updateOne({ _id: role._id }, { $set: { permissions: promote(role.permissions) } });
    if (staffRole._id && String(role._id) === String(staffRole._id)) staffRole.permissions = promote(role.permissions);
  }
  const retiredQuery = (fields) => ({ $or: fields.map((field) => ({ [field]: { $in: Object.keys(RETIRED) } })) });
  for await (const profile of adminProfiles.find(retiredQuery(["teamPermissions", "teamExtraPermissions", "teamRevokedPermissions"]))) {
    rewritten += 1;
    if (DRY_RUN) continue;
    await adminProfiles.updateOne(
      { _id: profile._id },
      {
        $set: {
          ...(hasRetired(profile.teamPermissions) ? { teamPermissions: promote(profile.teamPermissions) } : {}),
          ...(hasRetired(profile.teamExtraPermissions) ? { teamExtraPermissions: promote(profile.teamExtraPermissions) } : {}),
          ...(hasRetired(profile.teamRevokedPermissions) ? { teamRevokedPermissions: dropRetired(profile.teamRevokedPermissions) } : {}),
        },
      },
    );
  }
  for await (const profile of staffProfiles.find(retiredQuery(["permissions", "teamExtraPermissions", "teamRevokedPermissions"]))) {
    rewritten += 1;
    if (DRY_RUN) continue;
    await staffProfiles.updateOne(
      { _id: profile._id },
      {
        $set: {
          ...(hasRetired(profile.permissions) ? { permissions: promote(profile.permissions) } : {}),
          ...(hasRetired(profile.teamExtraPermissions) ? { teamExtraPermissions: promote(profile.teamExtraPermissions) } : {}),
          ...(hasRetired(profile.teamRevokedPermissions) ? { teamRevokedPermissions: dropRetired(profile.teamRevokedPermissions) } : {}),
        },
      },
    );
  }
  console.log(`  ${DRY_RUN ? "~ would rewrite" : "~ rewrote"} retired POS strings on ${rewritten} document(s)`);

  // 3. The store's staff with no role, onto Staff. Platform-owned profiles only
  // (managedBy "platform", or none and no vendor — lib/access/staff-ownership.ts),
  // and only accounts that are staff today.
  const staffUserIds = (await users.find({ role: { $in: STAFF_ROLES } }, { projection: { _id: 1 } }).toArray()).map(
    (user) => user._id,
  );
  const base = new Set(promote(staffRole.permissions));
  let moved = 0;
  for await (const profile of staffProfiles.find({
    userId: { $in: staffUserIds },
    $and: [
      { $or: [{ teamRoleId: { $exists: false } }, { teamRoleId: null }] },
      { $or: [{ managedBy: "platform" }, { managedBy: { $exists: false }, "vendorIds.0": { $exists: false } }] },
    ],
  })) {
    const own = promote(profile.permissions);
    const held = new Set(own);
    const extra = own.filter((permission) => !base.has(permission));
    const revoked = Array.from(base).filter((permission) => !held.has(permission));
    moved += 1;
    if (DRY_RUN) {
      console.log(`  → would move staff profile ${profile._id} onto Staff (+${extra.length} / −${revoked.length})`);
      continue;
    }
    await staffProfiles.updateOne(
      { _id: profile._id },
      {
        $set: {
          teamRoleId: staffRole._id,
          teamExtraPermissions: extra,
          teamRevokedPermissions: revoked,
          permissions: own,
        },
      },
    );
  }
  console.log(`  ${DRY_RUN ? "→ would move" : "→ moved"} ${moved} staff member(s) onto the Staff role`);

  console.log(DRY_RUN ? "✅ Dry run complete." : "✅ Done.");
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("❌ Migration failed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
