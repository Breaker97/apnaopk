/**
 * VendorPlan Model
 * Global catalog of subscription plans an admin offers to vendors.
 * Plans are never scoped to a vendor (no vendorId). A vendor's chosen plan is
 * recorded on their VendorSubscription; the effective commission is projected
 * onto Vendor.commission at write time.
 */

import mongoose, { Schema, Document, Model } from "mongoose";
import {
  VENDOR_PLAN_STATUS,
  VENDOR_BILLING_INTERVAL,
  type VendorPlanStatus,
  type VendorBillingInterval,
} from "@/config/app.config";
import {
  ALL_VENDOR_PACKS,
  type VendorPermissionPack,
} from "@/config/permissions.config";

interface IVendorPlanLimits {
  products?: number | null;
  staff?: number | null;
}

/** Plan feature flags. Unlike limits (absent = unlimited), a capability
 * defaults to false/off — a vendor only gets the feature when the plan
 * explicitly grants it. */
interface IVendorPlanCapabilities {
  /**
   * The capability packs this plan sells. This is the entitlement layer: a
   * vendor on the plan holds exactly these, and `Vendor.permissionOverrides`
   * records any deviation. An EMPTY/absent list means the plan predates packs;
   * `entitledPacks()` reads that as the commission-only baseline so a legacy
   * plan keeps gating exactly what it used to.
   */
  packs?: VendorPermissionPack[];
  /** @deprecated read as `packs.includes("aiStudio")`. Kept for rows and
   * clients written before packs existed; the migration folds it in. */
  aiAuthoring?: boolean;
}

export interface IVendorPlan extends Document {
  name: string;
  slug: string;
  description?: string;
  price: number;
  billingInterval: VendorBillingInterval;
  commissionRate: number;
  trialDays: number;
  features: string[];
  limits: IVendorPlanLimits;
  capabilities: IVendorPlanCapabilities;
  isDefault: boolean;
  status: VendorPlanStatus;
  sortOrder: number;
  stripeProductId?: string | null;
  stripePriceId?: string | null;
  stripePriceCurrency?: string | null;
  stripePriceActive?: boolean;
  stripeSyncedAt?: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const VendorPlanSchema = new Schema<IVendorPlan>(
  {
    name: {
      type: String,
      required: [true, "Plan name is required"],
      trim: true,
      maxlength: [80, "Name cannot exceed 80 characters"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    price: {
      type: Number,
      default: 0,
      min: [0, "Price cannot be negative"],
    },
    billingInterval: {
      type: String,
      enum: Object.values(VENDOR_BILLING_INTERVAL),
      default: VENDOR_BILLING_INTERVAL.NONE,
    },
    commissionRate: {
      type: Number,
      default: 0,
      min: [0, "Commission cannot be negative"],
      max: [100, "Commission cannot exceed 100%"],
    },
    trialDays: {
      type: Number,
      default: 0,
      min: [0, "Trial days cannot be negative"],
    },
    features: {
      type: [String],
      default: [],
    },
    limits: {
      type: new Schema<IVendorPlanLimits>(
        {
          products: { type: Number, default: null },
          staff: { type: Number, default: null },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    capabilities: {
      type: new Schema<IVendorPlanCapabilities>(
        {
          // What the plan sells. Absent = legacy row; see the interface note.
          packs: {
            type: [String],
            enum: ALL_VENDOR_PACKS,
            default: undefined,
          },
          // Absent/false = feature off; only an explicit true grants it.
          aiAuthoring: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: Object.values(VENDOR_PLAN_STATUS),
      default: VENDOR_PLAN_STATUS.ACTIVE,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    stripeProductId: {
      type: String,
      default: null,
    },
    stripePriceId: {
      type: String,
      default: null,
    },
    stripePriceCurrency: {
      type: String,
      default: null,
      uppercase: true,
      trim: true,
    },
    stripePriceActive: {
      type: Boolean,
      default: false,
    },
    stripeSyncedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// A trial only means something when there is a charge to defer, so trial days
// belong to PAID plans: the vendor sells for `trialDays` without ever entering
// a payment method, and pays only when the trial ends. A free plan has nothing
// to trial, so its value is coerced away rather than rejected — legacy rows
// written under the old rule (which allowed trial days ONLY on free plans) must
// still save cleanly.
VendorPlanSchema.pre("validate", function () {
  if (
    this.billingInterval === VENDOR_BILLING_INTERVAL.NONE &&
    this.trialDays > 0
  ) {
    this.trialDays = 0;
  }
});

// Admin list sorts by sortOrder then createdAt, optionally filtered by status;
// the onboarding step reads active plans by sortOrder.
VendorPlanSchema.index({ status: 1, sortOrder: 1, createdAt: -1 });
VendorPlanSchema.index({ stripePriceId: 1 });

// At most one default plan. A partial-unique index with an equality filter
// (portable to MongoDB 3.2+) enforces the invariant the clear-then-set writes
// only approximate; a concurrent second default insert then fails cleanly
// (handled as a 409 by the shared error handler) instead of creating two.
VendorPlanSchema.index(
  { isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);

export const VendorPlan: Model<IVendorPlan> =
  mongoose.models.VendorPlan ||
  mongoose.model<IVendorPlan>("VendorPlan", VendorPlanSchema);
