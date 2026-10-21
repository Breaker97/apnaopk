import mongoose from "mongoose";

/**
 * Team access hierarchy (3.1)
 * ===========================
 *
 * The team now has levels — the Owner, full administrators, administrators on
 * a narrower role, staff — and nobody gives or changes access at or above
 * their own. Two things are written down so every administrator's access is
 * an explicit row rather than a default:
 *
 *   1. adminprofiles — every administrator who is not the Owner and has no
 *      team role (one from before roles, or with no profile at all) is put on
 *      the built-in Administrator role with full access: what they already
 *      held, now stated. The built-in role is made when missing.
 *   2. teamroles, adminprofiles — "Manage team" is split. Adding members,
 *      giving them roles and changing a member's own permissions are separate
 *      grants now; a role or an administrator holding `manage_team` is given
 *      the three new ones too, so nobody loses what they could do.
 *
 * Then it lists the roles and administrators holding a permission only the
 * Owner may now give (config/team-permissions.config.ts
 * OWNER_ONLY_PERMISSIONS), for the Owner to review: they keep it, but
 * nobody but the Owner can hand it on.
 *
 * Safe to re-run: an administrator with a role is skipped, and a list that
 * already holds the new permissions is not touched.
 *
 * Usage:
 *   pnpm db:migrate team-access-hierarchy             # apply
 *   pnpm db:migrate team-access-hierarchy --dry-run   # report only
 */

const DRY_RUN = process.argv.includes("--dry-run");

// Kept in step with config/team-permissions.config.ts; a script cannot import
// the app's config.
const ADMINISTRATOR_ROLE = {
  key: "administrator",
  name: "Administrator",
  description: "Everything in the admin dashboard.",
  tier: "admin",
  allPermissions: true,
  permissions: [],
  assignableRoleIds: [],
  builtIn: true,
};
const SPLIT_OF_MANAGE_TEAM = ["create_team_members", "assign_team_roles", "edit_member_permissions"];
const OWNER_ONLY = [
  "manage_team",
  ...SPLIT_OF_MANAGE_TEAM,
  "manage_roles",
  "manage_users",
  "manage_sensitive_settings",
];

const strings = (list) => (Array.isArray(list) ? list.filter((value) => typeof value === "string") : []);
const withSplit = (list) => {
  const own = strings(list);
  return own.includes("manage_team") ? Array.from(new Set([...own, ...SPLIT_OF_MANAGE_TEAM])) : own;
};
const lacksSplit = (list) => strings(list).includes("manage_team") && SPLIT_OF_MANAGE_TEAM.some((p) => !strings(list).includes(p));

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
  const users = db.collection("user");

  // The built-in Administrator role.
  let administrator = await roles.findOne({ key: ADMINISTRATOR_ROLE.key });
  if (administrator && (administrator.tier !== "admin" || administrator.allPermissions !== true)) {
    console.error(`❌ The role keyed "${ADMINISTRATOR_ROLE.key}" is not the full-access Administrator; fix it and re-run.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  if (!administrator) {
    if (DRY_RUN) {
      console.log("  + would create the built-in Administrator role");
      administrator = { _id: null, ...ADMINISTRATOR_ROLE };
    } else {
      const now = new Date();
      const inserted = await roles.insertOne({ ...ADMINISTRATOR_ROLE, createdAt: now, updatedAt: now });
      administrator = { _id: inserted.insertedId, ...ADMINISTRATOR_ROLE };
      console.log("  + created the built-in Administrator role");
    }
  } else {
    console.log("  = the built-in Administrator role is already there");
  }

  // 1. Administrators with no team role, onto the Administrator role.
  const onAdministrator = {
    teamRoleId: administrator._id,
    teamFullAccess: true,
    teamPermissions: [],
    teamExtraPermissions: [],
    teamRevokedPermissions: [],
  };
  const admins = await users
    .find({ $or: [{ role: "admin" }, { roles: "admin" }] }, { projection: { _id: 1, email: 1 } })
    .toArray();
  let stamped = 0;
  let created = 0;
  for (const admin of admins) {
    const profile = await adminProfiles.findOne(
      { userId: admin._id },
      { projection: { isSuperAdmin: 1, teamRoleId: 1 } },
    );
    if (profile?.isSuperAdmin || profile?.teamRoleId) continue;
    if (!profile) {
      created += 1;
      if (DRY_RUN) {
        console.log(`  → would give ${admin.email || admin._id} a profile on the Administrator role`);
        continue;
      }
      const now = new Date();
      await adminProfiles.insertOne({
        userId: admin._id,
        isSuperAdmin: false,
        permissions: [],
        ...onAdministrator,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }
    stamped += 1;
    if (DRY_RUN) {
      console.log(`  → would put ${admin.email || admin._id} on the Administrator role`);
      continue;
    }
    await adminProfiles.updateOne({ _id: profile._id }, { $set: { ...onAdministrator, updatedAt: new Date() } });
  }
  console.log(
    `  ${DRY_RUN ? "→ would put" : "→ put"} ${stamped + created} administrator(s) on the Administrator role` +
      (created > 0 ? ` (${created} had no profile)` : ""),
  );

  // 2. "Manage team" split into its three new grants.
  let split = 0;
  for await (const role of roles.find({ permissions: "manage_team" })) {
    if (!lacksSplit(role.permissions)) continue;
    split += 1;
    if (DRY_RUN) {
      console.log(`  ~ would add the three team grants to the ${role.name} role`);
      continue;
    }
    await roles.updateOne({ _id: role._id }, { $set: { permissions: withSplit(role.permissions), updatedAt: new Date() } });
  }
  for await (const profile of adminProfiles.find({
    $or: [{ teamPermissions: "manage_team" }, { teamExtraPermissions: "manage_team" }],
  })) {
    if (!lacksSplit(profile.teamPermissions) && !lacksSplit(profile.teamExtraPermissions)) continue;
    split += 1;
    if (DRY_RUN) continue;
    await adminProfiles.updateOne(
      { _id: profile._id },
      {
        $set: {
          ...(lacksSplit(profile.teamPermissions) ? { teamPermissions: withSplit(profile.teamPermissions) } : {}),
          ...(lacksSplit(profile.teamExtraPermissions) ? { teamExtraPermissions: withSplit(profile.teamExtraPermissions) } : {}),
          updatedAt: new Date(),
        },
      },
    );
  }
  console.log(`  ${DRY_RUN ? "~ would split" : "~ split"} Manage team on ${split} role(s) and profile(s)`);

  // For the Owner to review: who holds what only the Owner gives now.
  const powerful = await roles
    .find({ allPermissions: { $ne: true }, permissions: { $in: OWNER_ONLY } }, { projection: { name: 1, permissions: 1 } })
    .toArray();
  for (const role of powerful) {
    const held = strings(role.permissions).filter((permission) => OWNER_ONLY.includes(permission));
    console.log(`  ! the ${role.name} role holds ${held.join(", ")} (only the Owner can give these now)`);
  }
  const fullAdmins = await adminProfiles.countDocuments({ isSuperAdmin: { $ne: true }, teamFullAccess: true });
  console.log(`  ! ${fullAdmins} administrator(s) besides the Owner have full access; only the Owner can change them now`);

  console.log(DRY_RUN ? "✅ Dry run complete." : "✅ Done.");
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("❌ Migration failed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
