import { mongoose } from "@/lib/db";
import type { ICustomerProfile } from "@/types";
import type { Model } from "mongoose";

const { Schema, models, model } = mongoose;

/**
 * Email Notification Preferences Sub-Schema
 */
const EmailNotificationsSchema = new Schema(
  {
    orderUpdates: { type: Boolean, default: true },
    promotions: { type: Boolean, default: false },
    newsletter: { type: Boolean, default: false },
    priceDrops: { type: Boolean, default: false },
    backInStock: { type: Boolean, default: false },
  },
  { _id: false },
);

const CustomerShippingAddressSchema = new Schema(
  {
    firstName: { type: String },
    lastName: { type: String },
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String },
    apartment: { type: String },
    postalCode: { type: String, required: true },
    country: { type: String, required: true },
    phone: { type: String },
    isDefault: { type: Boolean, default: true },
    label: { type: String, default: "home" },
  },
  { _id: false },
);

/**
 * Customer Stats Cache Sub-Schema
 */
const CustomerStatsSchema = new Schema(
  {
    totalOrders: { type: Number, default: 0, min: 0 },
    totalSpent: { type: Number, default: 0, min: 0 },
    averageOrderValue: { type: Number, default: 0, min: 0 },
    lastOrderDate: { type: Date },
    totalReviews: { type: Number, default: 0, min: 0 },
    averageRating: { type: Number, min: 0, max: 5 },
    totalWishlistItems: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

/**
 * Loyalty Tiers
 */
const LOYALTY_TIERS = ["bronze", "silver", "gold", "platinum"] as const;

/**
 * Customer Profile Schema
 * Stores customer-specific data separate from core User model:
 * loyalty, preferences, marketing settings, cached stats, and segmentation
 */
const CustomerProfileSchema = new Schema<ICustomerProfile>(
  {
    // Absent on guest rows — a guest checkout creates a customer record with
    // no login behind it, exactly like Shopify's account-less customers.
    // Uniqueness is enforced by the partial index below, not here, so any
    // number of guest rows can omit the field.
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    // Guest identity, present only while `isGuest` is true. A guest checkout
    // upserts one row per email; when that shopper later registers (or logs
    // in) with the same email, the claim in lib/customer.ts attaches userId
    // and clears these three fields — the User becomes the identity source.
    isGuest: {
      type: Boolean,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      trim: true,
    },

    // Loyalty & Rewards
    loyaltyPoints: {
      type: Number,
      default: 0,
      min: 0,
    },
    loyaltyTier: {
      type: String,
      enum: LOYALTY_TIERS,
      default: "bronze",
    },
    lifetimePoints: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Shopping Preferences
    preferredPaymentMethod: { type: String },
    preferredCurrency: { type: String },
    preferredLanguage: { type: String },
    preferredCategories: [
      { type: Schema.Types.ObjectId, ref: "Category" },
    ],
    sizePreferences: { type: Schema.Types.Mixed },

    // Marketing & Communication
    marketingOptIn: {
      type: Boolean,
      default: false,
    },
    emailNotifications: {
      type: EmailNotificationsSchema,
      default: () => ({}),
    },

    // Cached Stats
    stats: {
      type: CustomerStatsSchema,
      default: () => ({}),
    },

    // Segmentation
    tags: { type: [String], default: [] },
    notes: { type: String, maxlength: 2000 },

    // Acquisition
    acquisitionSource: { type: String },
    referredBy: { type: Schema.Types.ObjectId, ref: "User" },
    shippingAddress: { type: CustomerShippingAddressSchema },

    // Activity
    lastActiveAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes
//
// userId uniqueness moved off the path (`unique: true`) into a partial index
// so guest rows — which have no userId at all — don't collide on the nulls a
// plain unique index would store for them. Existing stores must run
// `pnpm db:migrate guest-customers` to swap the old index for these two.
CustomerProfileSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { userId: { $type: "objectId" } },
  },
);
// One guest row per email; registered rows don't carry `email` (it lives on
// the User), so the partial filter keeps them out of the constraint.
CustomerProfileSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { isGuest: true } },
);
CustomerProfileSchema.index({ loyaltyTier: 1 });
CustomerProfileSchema.index({ "stats.totalSpent": -1 });
CustomerProfileSchema.index({ tags: 1 });
CustomerProfileSchema.index({ lastActiveAt: -1 });
// Default sort of the admin customer list (now paginated before the user join).
CustomerProfileSchema.index({ createdAt: -1 });

// Virtual for user
CustomerProfileSchema.virtual("user", {
  ref: "User",
  localField: "userId",
  foreignField: "_id",
  justOne: true,
});

export const CustomerProfile: Model<ICustomerProfile> =
  models.CustomerProfile ||
  model<ICustomerProfile>("CustomerProfile", CustomerProfileSchema);
