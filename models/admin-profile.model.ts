import { mongoose } from "@/lib/db";
import {
  ADMIN_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
} from "@/config/permissions.config";
import type { Types } from "mongoose";
import type { AdminPermission } from "@/config/permissions.config";

const { Schema, models, model } = mongoose;

/**
 * Admin Profile Interface
 */
interface IAdminProfile {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  permissions: AdminPermission[];
  department?: string;
  isSuperAdmin: boolean;
  /**
   * The member's team role (models/team-role.model.ts). Absent on rows from
   * before roles: such an administrator holds everything, as before.
   */
  teamRoleId?: Types.ObjectId;
  /** Granted on top of the role. */
  teamExtraPermissions?: string[];
  /** Taken away from the role. */
  teamRevokedPermissions?: string[];
  /**
   * What the member holds, written from the role and the two lists above
   * (lib/access/team-permissions.ts). `teamFullAccess` means everything,
   * including permissions a later release adds.
   */
  teamPermissions?: string[];
  teamFullAccess?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Admin Profile Schema
 * Stores admin-specific data with granular permissions
 */
const AdminProfileSchema = new Schema<IAdminProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    permissions: {
      type: [String],
      enum: Object.values(ADMIN_PERMISSIONS),
      default: [],
    },
    department: {
      type: String,
      trim: true,
    },
    isSuperAdmin: {
      type: Boolean,
      default: false,
    },
    teamRoleId: { type: Schema.Types.ObjectId, ref: "TeamRole" },
    teamExtraPermissions: { type: [String], default: undefined },
    teamRevokedPermissions: { type: [String], default: undefined },
    teamPermissions: { type: [String], default: undefined },
    teamFullAccess: { type: Boolean },
  },
  {
    timestamps: true,
  },
);

// Indexes
AdminProfileSchema.index({ isSuperAdmin: 1 });
// A role's members, re-written when the role changes.
AdminProfileSchema.index({ teamRoleId: 1 }, { sparse: true });

// Virtual for user
AdminProfileSchema.virtual("user", {
  ref: "User",
  localField: "userId",
  foreignField: "_id",
  justOne: true,
});

// Helper method to get all permissions (including super admin override)
AdminProfileSchema.methods.getAllPermissions = function (): AdminPermission[] {
  if (this.isSuperAdmin) {
    return SUPER_ADMIN_PERMISSIONS;
  }
  return this.permissions;
};

// Helper method to check if has a specific permission
AdminProfileSchema.methods.hasPermission = function (
  permission: AdminPermission,
): boolean {
  if (this.isSuperAdmin) return true;
  return this.permissions.includes(permission);
};

export const AdminProfile =
  models.AdminProfile ||
  model<IAdminProfile>("AdminProfile", AdminProfileSchema);
