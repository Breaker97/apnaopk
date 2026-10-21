import { Types } from "mongoose";
import { TeamRole, type ITeamRole } from "@/models/team-role.model";
import { BUILT_IN_TEAM_ROLES } from "@/config/team-permissions.config";

/**
 * Where team roles are stored. Kept apart from lib/access/team-permissions.ts,
 * which every administrator's request reads: answering "what may this member
 * do" needs only their profile, never the roles collection.
 */

/**
 * Makes the built-in roles that are missing (never overwrites one the store
 * has edited). Cheap after the first call: one indexed read.
 */
export async function ensureBuiltInTeamRoles(): Promise<void> {
  const keys = BUILT_IN_TEAM_ROLES.map((role) => role.key);
  const present = new Set(
    (await TeamRole.find({ key: { $in: keys } }).select("key").lean<{ key: string }[]>()).map(
      (row) => row.key,
    ),
  );
  for (const role of BUILT_IN_TEAM_ROLES) {
    if (present.has(role.key)) continue;
    await TeamRole.updateOne(
      { key: role.key },
      {
        $setOnInsert: {
          key: role.key,
          name: role.name,
          description: role.description,
          tier: role.tier,
          allPermissions: role.allPermissions,
          permissions: role.permissions,
          builtIn: true,
        },
      },
      { upsert: true },
    );
  }
}

export async function findTeamRole(
  idOrKey: string,
): Promise<(ITeamRole & { _id: Types.ObjectId }) | null> {
  await ensureBuiltInTeamRoles();
  const query = Types.ObjectId.isValid(idOrKey) ? { _id: idOrKey } : { key: idOrKey };
  return TeamRole.findOne(query).lean<ITeamRole & { _id: Types.ObjectId }>();
}
