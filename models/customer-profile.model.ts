import { mongoose } from "@/lib/db";
import {
  MARKETING_CONSENT_SOURCES,
  MARKETING_CONSENT_STATE,
  MARKETING_CONSENT_STATES,
  MARKETING_OPT_IN_LEVELS,
} from "@/config/app.config";
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

/**
 * Text-message opt-out. On by default because the store decides which events
 * are texted at all (Settings → Notifications, SMS off everywhere until then);
 * this is the shopper's way out of the ones it chose.
 */
const SmsNotificationsSchema = new Schema(
  {
    orderUpdates: { type: Boolean, default: true },
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
 * Marketing consent, one record per channel.
 *
 * Every field but the state answers a question an audit asks later: when the
 * shopper agreed, how (a tick-box, or a link they confirmed), where from, and
 * — for a checkout — under which order and from which country. The state
 * machine itself lives in `lib/customers/marketing-consent.ts`; nothing else
 * may write these paths, or the history below goes out of step with them.
 */
const marketingConsentFields = () => ({
  state: {
    type: String,
    enum: MARKETING_CONSENT_STATES,
    default: MARKETING_CONSENT_STATE.NOT_SUBSCRIBED,
  },
  optInLevel: { type: String, enum: MARKETING_OPT_IN_LEVELS },
  consentUpdatedAt: { type: Date },
  source: { type: String, enum: MARKETING_CONSENT_SOURCES },
  /** The order the tick-box was on, where the consent came from a checkout. */
  sourceOrderId: { type: String },
  /** The delivery country at the time — which decides whether a pre-tick was legal. */
  sourceCountry: { type: String },
  ip: { type: String },
  /** When a double opt-in link was followed. */
  confirmedAt: { type: Date },
});

const MarketingConsentSchema = new Schema(marketingConsentFields(), {
  _id: false,
});

const SmsMarketingConsentSchema = new Schema(
  {
    ...marketingConsentFields(),
    /** The number consented on, in E.164 — not necessarily the delivery phone. */
    phone: { type: String, trim: true },
  },
  { _id: false },
);

const MarketingConsentHistorySchema = new Schema(
  {
    channel: { type: String, enum: ["email", "sms"], required: true },
    state: { type: String, enum: MARKETING_CONSENT_STATES, required: true },
    optInLevel: { type: String, enum: MARKETING_OPT_IN_LEVELS },
    at: { type: Date, required: true },
    source: { type: String, enum: MARKETING_CONSENT_SOURCES },
    sourceOrderId: { type: String },
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
    /**
     * A guest who checked out with a phone number and no email, in E.164.
     * Their consent to be texted has to live somewhere, and an email-keyed
     * row cannot hold it. Set only on guest rows; a registered shopper's
     * number is on the User.
     */
    phone: {
      type: String,
      trim: true,
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
    //
    // `marketingOptIn` is the boolean this started as, kept in step with
    // `emailMarketing.state` by `setMarketingConsent` so older readers (and
    // anything still filtering on it) keep working. New code reads the state.
    marketingOptIn: {
      type: Boolean,
      default: false,
    },
    emailMarketing: {
      type: MarketingConsentSchema,
      default: () => ({}),
    },
    smsMarketing: {
      type: SmsMarketingConsentSchema,
      default: () => ({}),
    },
    /**
     * The last few consent changes, newest last, capped by the helper that
     * writes them. Shopify keeps only the current record; this trail is what
     * answers "who subscribed this address, and when" months later, which is
     * the question an audit actually asks.
     */
    marketingConsentHistory: {
      type: [MarketingConsentHistorySchema],
      default: [],
    },
    /**
     * The token behind the unsubscribe link in every marketing email. Minted
     * the first time a shopper subscribes, and never rotated: links in mail
     * already sent have to keep working. A guest has no account to sign in to,
     * so without this there is no way out for them at all.
     */
    unsubscribeToken: { type: String },
    emailNotifications: {
      type: EmailNotificationsSchema,
      default: () => ({}),
    },
    smsNotifications: {
      type: SmsNotificationsSchema,
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
// the User), so the partial filter keeps them out of the constraint — and so
// does a guest who left a phone number instead, whose row has no email at all.
// Without the `$type` clause every such row indexes as the same null key, and
// the second phone-only shopper collided with the first.
CustomerProfileSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { isGuest: true, email: { $type: "string" } },
  },
);
// The customer list's email-subscription filter, and the recovery sweep's
// "only shoppers who agreed" query, both match on the state alone.
CustomerProfileSchema.index({ "emailMarketing.state": 1 });
// Found by token when an unsubscribe link is opened; only subscribed rows
// carry one, so the index stays small and the uniqueness skips the rest.
CustomerProfileSchema.index(
  { unsubscribeToken: 1 },
  { unique: true, partialFilterExpression: { unsubscribeToken: { $type: "string" } } },
);
// One guest row per phone number, for the shopper who left no email.
CustomerProfileSchema.index(
  { phone: 1 },
  {
    unique: true,
    partialFilterExpression: { phone: { $type: "string" }, isGuest: true },
  },
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
