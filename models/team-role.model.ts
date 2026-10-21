import { mongoose } from "@/lib/db";
import type { Types } from "mongoose";
import {
  TEAM_ROLE_TIERS,
  type TeamPermission,
  type TeamRoleTier,
} from "@/config/team-permissions.config";

const { Schema, models, model } = mongoose;

/**
 * A role on the store's own team: a name and the permissions its members
 * hold (config/team-permissions.config.ts). The built-in Administrator and
 * Manager are rows like any other, made on first use and keyed by `key`;
 * the store adds its own.
 *
 * A member's effective permissions are written onto their profile
 * (`AdminProfile.teamPermissions`, `StaffProfile.permissions`) whenever the
 * role or the member changes (lib/access/team-permissions.ts), so the guards
 * read one field and never join the role.
 */
export interface ITeamRole {
  _id: Types.ObjectId;
  /** Stable handle: the built-ins' (`administrator`, `manager`) or a slug of the name. */
  key: string;
  name: string;
  description?: string;
  /** The dashboard its members work in: admin (any permission) or staff (staff permissions). */
  tier: TeamRoleTier;
  /** Every permission, including ones a later release adds (Administrator). */
  allPermissions: boolean;
  permissions: TeamPermission[];
  /**
   * The roles this role's members may give someone, set by the Owner. A
   * member on a narrower role adds people, or moves them, only onto these
   * (lib/access/team-member-roles.ts); a full administrator gives any role
   * but the Administrator, and the Owner any at all.
   */
  assignableRoleIds: Types.ObjectId[];
  builtIn: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TeamRoleSchema = new Schema<ITeamRole>(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 300 },
    tier: { type: String, enum: TEAM_ROLE_TIERS, required: true, default: "admin" },
    allPermissions: { type: Boolean, default: false },
    // Validated where written (lib/access/team-permissions.ts): an enum here
    // would make a row from a newer release unreadable after a rollback.
    permissions: { type: [String], default: [] },
    assignableRoleIds: { type: [Schema.Types.ObjectId], ref: "TeamRole", default: [] },
    builtIn: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const TeamRole =
  models.TeamRole || model<ITeamRole>("TeamRole", TeamRoleSchema);
