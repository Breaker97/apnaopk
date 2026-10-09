import { mongoose } from "@/lib/db";
import {
  STAFF_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
} from "@/config/permissions.config";
import type { Types } from "mongoose";
import type { StaffPermission } from "@/config/permissions.config";
import type { StaffAccessScope } from "@/lib/access/staff-scope";

const { Schema, models, model } = mongoose;

export interface IStaffProfile {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  permissions: StaffPermission[];
  /**
   * Who manages this staff member — the platform admin or a vendor. Absent on
   * rows written before the field existed; lib/staff-ownership.ts derives
   * those from `vendorIds`, which doubles as the admin-granted data-access
   * scope and therefore cannot itself mean ownership.
   */
  managedBy?: "platform" | "vendor";
  vendorIds?: Types.ObjectId[];
  locationIds?: string[];
  fulfillmentRegions?: string[];
  assignedBy: Types.ObjectId;
  department?: string;
  jobTitle?: string;
  startDate?: Date;
  notes?: string;
  /**
   * Dated internal notes, newest last. The single `notes` string above is the
   * standing summary an admin keeps editing; these are the entries they add
   * over time, each stamped with who wrote it.
   */
  noteEntries?: {
    _id?: Types.ObjectId;
    body: string;
    authorId?: Types.ObjectId;
    authorEmail?: string;
    createdAt: Date;
  }[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const StaffProfileSchema = new Schema<IStaffProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    permissions: {
      type: [String],
      enum: Object.values(STAFF_PERMISSIONS),
      default: DEFAULT_STAFF_PERMISSIONS,
    },
    // No default: both create paths set it explicitly, and a schema default
    // would mislabel legacy rows the moment they are re-saved.
    managedBy: {
      type: String,
      enum: ["platform", "vendor"],
    },
    vendorIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Vendor" }],
      default: [],
    },
    locationIds: {
      type: [String],
      default: [],
      set: (values: unknown[]) =>
        Array.isArray(values)
          ? values.map((value) => String(value).trim()).filter(Boolean)
          : [],
    },
    fulfillmentRegions: {
      type: [String],
      default: [],
      set: (values: unknown[]) =>
        Array.isArray(values)
          ? values.map((value) => String(value).trim()).filter(Boolean)
          : [],
    },
    assignedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    department: {
      type: String,
      trim: true,
    },
    jobTitle: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    startDate: {
      type: Date,
    },
    notes: {
      type: String,
      trim: true,
    },
    noteEntries: {
      type: [
        new Schema(
          {
            body: { type: String, required: true, trim: true, maxlength: 2000 },
            authorId: { type: Schema.Types.ObjectId, ref: "User" },
            authorEmail: { type: String, trim: true },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: true },
        ),
      ],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

StaffProfileSchema.index({ isActive: 1 });
StaffProfileSchema.index({ assignedBy: 1 });
StaffProfileSchema.index({ vendorIds: 1 });
StaffProfileSchema.index({ managedBy: 1 });
StaffProfileSchema.index({ locationIds: 1 });

StaffProfileSchema.virtual("user", {
  ref: "User",
  localField: "userId",
  foreignField: "_id",
  justOne: true,
});

StaffProfileSchema.methods.hasPermission = function (
  permission: StaffPermission,
): boolean {
  if (!this.isActive) return false;
  return this.permissions.includes(permission);
};

StaffProfileSchema.methods.getAllPermissions = function (): StaffPermission[] {
  if (!this.isActive) return [];
  return this.permissions;
};

StaffProfileSchema.methods.getScope = function (): StaffAccessScope {
  return {
    vendorIds: Array.isArray(this.vendorIds)
      ? this.vendorIds.map((id: Types.ObjectId) => id.toString())
      : [],
    locationIds: Array.isArray(this.locationIds) ? this.locationIds : [],
    fulfillmentRegions: Array.isArray(this.fulfillmentRegions)
      ? this.fulfillmentRegions
      : [],
  };
};

export const StaffProfile =
  models.StaffProfile ||
  model<IStaffProfile>("StaffProfile", StaffProfileSchema);

