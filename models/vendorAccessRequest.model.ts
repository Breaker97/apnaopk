/**
 * VendorAccessRequest Model
 *
 * A vendor asking for a capability pack their entitlement does not include.
 * This is the second of the three doors in
 * docs/VENDOR_PERMISSIONS_GUIDELINE.md §2.4 — the other two being a plan
 * upgrade (self-serve, no record needed because it is entitlement) and a
 * direct admin grant.
 *
 * The request is deliberately its own document rather than a note on the
 * vendor: it has a lifecycle (pending → approved/declined), an author on each
 * side, and it must survive the decision so "we asked and were told no" stays
 * answerable. Approving it writes a `Vendor.permissionOverrides` entry and an
 * audit log row; the request itself never grants anything.
 */

import mongoose, { Schema, Document, Model, Types } from "mongoose";
import {
  ALL_VENDOR_PACKS,
  type VendorPermissionPack,
} from "@/config/permissions.config";

export const VENDOR_ACCESS_REQUEST_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  DECLINED: "declined",
  WITHDRAWN: "withdrawn",
} as const;

type VendorAccessRequestStatus =
  (typeof VENDOR_ACCESS_REQUEST_STATUS)[keyof typeof VENDOR_ACCESS_REQUEST_STATUS];

/**
 * How long the override should last if approved. Stored as the vendor's ask,
 * not as a date, so an approval two days later still gets a full window.
 */
export const VENDOR_ACCESS_REQUEST_DURATIONS = {
  PERMANENT: "permanent",
  DAYS_30: "30d",
  DAYS_90: "90d",
} as const;

export type VendorAccessRequestDuration =
  (typeof VENDOR_ACCESS_REQUEST_DURATIONS)[keyof typeof VENDOR_ACCESS_REQUEST_DURATIONS];

const REQUEST_DURATION_DAYS: Record<
  VendorAccessRequestDuration,
  number | null
> = {
  permanent: null,
  "30d": 30,
  "90d": 90,
};

export interface IVendorAccessRequest extends Document {
  vendorId: Types.ObjectId;
  pack: VendorPermissionPack;
  reason: string;
  duration: VendorAccessRequestDuration;
  status: VendorAccessRequestStatus;
  requestedBy: string;
  requestedAt: Date;
  decidedBy?: string | null;
  decidedAt?: Date | null;
  decisionNote?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const VendorAccessRequestSchema = new Schema<IVendorAccessRequest>(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    pack: {
      type: String,
      enum: ALL_VENDOR_PACKS,
      required: true,
    },
    reason: {
      type: String,
      required: [true, "Tell the admin why you need this"],
      trim: true,
      maxlength: [1000, "Reason cannot exceed 1000 characters"],
    },
    duration: {
      type: String,
      enum: Object.values(VENDOR_ACCESS_REQUEST_DURATIONS),
      default: VENDOR_ACCESS_REQUEST_DURATIONS.DAYS_30,
    },
    status: {
      type: String,
      enum: Object.values(VENDOR_ACCESS_REQUEST_STATUS),
      default: VENDOR_ACCESS_REQUEST_STATUS.PENDING,
      index: true,
    },
    requestedBy: { type: String, required: true },
    requestedAt: { type: Date, default: Date.now },
    decidedBy: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: {
      type: String,
      default: null,
      maxlength: [1000, "Note cannot exceed 1000 characters"],
    },
  },
  { timestamps: true },
);

// The admin queue reads pending rows newest-first; a vendor's own list reads by
// vendor. Both are covered by this compound index.
VendorAccessRequestSchema.index({ status: 1, requestedAt: -1 });
VendorAccessRequestSchema.index({ vendorId: 1, requestedAt: -1 });

// One open request per vendor per pack. Without this a vendor could queue the
// same ask five times and an admin would approve it five times, writing five
// identical overrides. Partial so decided rows accumulate freely as history.
VendorAccessRequestSchema.index(
  { vendorId: 1, pack: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: VENDOR_ACCESS_REQUEST_STATUS.PENDING,
    },
  },
);

export const VendorAccessRequest: Model<IVendorAccessRequest> =
  (mongoose.models.VendorAccessRequest as Model<IVendorAccessRequest>) ||
  mongoose.model<IVendorAccessRequest>(
    "VendorAccessRequest",
    VendorAccessRequestSchema,
  );

/** Resolve the ask into an override expiry. Null = until revoked. */
export function expiryForDuration(
  duration: VendorAccessRequestDuration,
  from: Date = new Date(),
): Date | null {
  const days = REQUEST_DURATION_DAYS[duration];
  if (days == null) return null;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
