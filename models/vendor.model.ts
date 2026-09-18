import { mongoose } from "@/lib/db";
import {
  COD_COLLECTED_BY,
  COD_COLLECTED_BY_INHERIT,
  VENDOR_STATUS,
} from "@/config/app.config";
import { DEFAULT_VENDOR_PERMISSIONS, VENDOR_PERMISSIONS } from "@/config/permissions.config";
import type { IVendor, Address, BankDetails, VendorDocuments } from "@/types";
import { DEFAULT_VENDOR_COMMISSION_RATE } from "@/lib/orders/order-settings";
import {
  DEFAULT_VENDOR_ADDRESS_DISPLAY,
  VENDOR_ADDRESS_DISPLAY_VALUES,
  type VendorStoreVisibility,
} from "@/lib/vendors/vendor-address";
import { SOCIAL_PLATFORMS } from "@/lib/site-config/social-profiles";
import type { VendorMessagingSettings } from "@/lib/notifications/vendor-messaging";

const { Schema, models, model } = mongoose;
const existingVendorModel = models.Vendor as typeof models.Vendor | undefined;
const existingVendorPermissionsPath = existingVendorModel?.schema.path(
  "permissions",
) as { enumValues?: string[] } | undefined;
if (
  existingVendorModel &&
  (!existingVendorModel.schema.path("permissions") ||
    !Object.values(VENDOR_PERMISSIONS).every((permission) =>
      existingVendorPermissionsPath?.enumValues?.includes(permission),
    ) ||
    !existingVendorModel.schema.path("shareSettings") ||
    !existingVendorModel.schema.path("documents") ||
    !existingVendorModel.schema.path("planId") ||
    !existingVendorModel.schema.path("notes") ||
    !existingVendorModel.schema.path("storeActive") ||
    !existingVendorModel.schema.path("verified") ||
    !existingVendorModel.schema.path("onboardingResponses") ||
    !existingVendorModel.schema.path("storeVisibility") ||
    !existingVendorModel.schema.path("messaging") ||
    !existingVendorModel.schema.path("socialProfiles") ||
    !existingVendorModel.schema.path("stripeCustomerId") ||
    !existingVendorModel.schema.path("shipping.localPickup.locations") ||
    // Without this entry a dev session that already cached the schema would
    // silently drop every carrier write — the failure mode this whole guard
    // exists for.
    !existingVendorModel.schema.path("shipping.carriers") ||
    // Same reason as the carriers entry above: a cached schema without this
    // path would silently drop every override write, which is now the only
    // place a vendor's access deviation is stored.
    !existingVendorModel.schema.path("permissionOverrides"))
) {
  delete models.Vendor;
}

/**
 * One deviation from the plan's entitlement.
 *
 * `grant` adds a permission the entitlement does not include; `revoke` removes
 * one it does. Both carry an author and a reason because the question an admin
 * asks later is never "what" but "who decided this, and why".
 *
 * `expiresAt` is what makes temporary access practical — most requests are for
 * a campaign or a trial, and an expiring row needs no follow-up from anyone.
 * `activeOverrides()` filters expired rows on read, so nothing has to sweep.
 */
const VendorPermissionOverrideSchema = new Schema(
  {
    permission: {
      type: String,
      enum: Object.values(VENDOR_PERMISSIONS),
      required: true,
    },
    mode: {
      type: String,
      enum: ["grant", "revoke"],
      required: true,
    },
    reason: { type: String, maxlength: [500, "Reason cannot exceed 500 characters"] },
    grantedBy: { type: String },
    grantedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
  },
  { _id: false },
);

/**
 * Address Sub-Schema
 * All fields are optional to support partial address input
 */
const AddressSchema = new Schema<Address>(
  {
    street: { type: String },
    city: { type: String },
    state: { type: String },
    postalCode: { type: String },
    country: { type: String },
    phone: { type: String },
    // Resolved from the text address by the geocoder when the vendor saves, so
    // the storefront's Directions link can drop an exact pin instead of handing
    // Maps a phrase to search for. Absent until a lookup succeeds — every
    // reader must tolerate that, including for vendors created before this
    // field existed.
    coordinates: {
      type: new Schema(
        {
          lat: { type: Number },
          lng: { type: Number },
          /** What the geocoder matched, kept so a wrong pin is debuggable. */
          formatted: { type: String },
          geocodedAt: { type: String },
        },
        { _id: false },
      ),
    },
    // The same point as `coordinates`, in the GeoJSON shape the 2dsphere index
    // needs for the storefront's radius search. Derived, never hand-authored:
    // build it with `vendorGeoPoint()` so the [lng, lat] axis order is applied
    // in one place. Absent whenever `coordinates` is.
    geo: {
      type: new Schema(
        {
          type: { type: String, enum: ["Point"] },
          coordinates: { type: [Number] },
        },
        { _id: false },
      ),
    },
  },
  { _id: false },
);

/**
 * Bank Details Sub-Schema
 * All fields are optional to support partial bank details input
 */
const BankDetailsSchema = new Schema<BankDetails>(
  {
    accountName: { type: String },
    accountNumber: { type: String },
    bankName: { type: String },
    routingNumber: { type: String },
    swiftCode: { type: String },
  },
  { _id: false },
);

/**
 * Verification Documents Sub-Schema
 * All fields optional — a vendor may submit documents at registration or
 * hand them to an admin afterwards.
 */
const VendorDocumentsSchema = new Schema<VendorDocuments>(
  {
    businessLicense: { type: String },
    taxId: { type: String },
    taxCertificate: { type: String },
    governmentId: { type: String },
  },
  { _id: false },
);

/**
 * Vendor's own social profiles, published in the storefront's Store information
 * panel. A list so each seller can pick the platforms that matter to them; see
 * `lib/social-profiles.ts`. The legacy fixed `socialLinks.facebook/instagram/
 * twitter` fields are kept for backward compatibility and used as a fallback
 * when this list is empty.
 */
const VendorSocialProfileSchema = new Schema(
  {
    id: { type: String },
    platform: { type: String, enum: [...SOCIAL_PLATFORMS], default: "other" },
    label: { type: String, maxlength: 40 },
    url: { type: String, required: true, maxlength: 500 },
  },
  { _id: false },
);

/**
 * Storefront Visibility Sub-Schema
 *
 * Gates what the public store page may publish about the vendor. `address` is
 * collected for payouts/KYC, so `addressDisplay` defaults to city + country —
 * never `full` — and existing vendors inherit that default without a migration.
 * `showPhone` is separate because publishing a number invites spam.
 */
const VendorStoreVisibilitySchema = new Schema<VendorStoreVisibility>(
  {
    addressDisplay: {
      type: String,
      enum: [...VENDOR_ADDRESS_DISPLAY_VALUES],
      default: DEFAULT_VENDOR_ADDRESS_DISPLAY,
    },
    showPhone: { type: Boolean, default: false },
  },
  { _id: false },
);

const VendorMessagingSchema = new Schema<VendorMessagingSettings>(
  {
    liveChatEnabled: { type: Boolean, default: true },
    whatsapp: {
      enabled: { type: Boolean, default: false },
      phoneNumberE164: { type: String, trim: true, maxlength: 16 },
    },
    messenger: {
      enabled: { type: Boolean, default: false },
      pageUsername: { type: String, trim: true, maxlength: 100 },
    },
    instagram: {
      enabled: { type: Boolean, default: false },
      username: { type: String, trim: true, maxlength: 100 },
    },
    telegram: {
      enabled: { type: Boolean, default: false },
      username: { type: String, trim: true, maxlength: 100 },
    },
  },
  { _id: false },
);

/**
 * Social Links Sub-Schema
 */
const SocialLinksSchema = new Schema(
  {
    website: { type: String },
    facebook: { type: String },
    instagram: { type: String },
    twitter: { type: String },
  },
  { _id: false },
);

const CustomShareButtonSchema = new Schema(
  {
    id: { type: String },
    label: { type: String },
    urlTemplate: { type: String },
    enabled: { type: Boolean, default: true },
    icon: { type: String },
  },
  { _id: false },
);

const VendorShareSettingsSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    copyLink: { type: Boolean, default: true },
    facebook: { type: Boolean, default: true },
    twitter: { type: Boolean, default: true },
    whatsapp: { type: Boolean, default: true },
    telegram: { type: Boolean, default: false },
    pinterest: { type: Boolean, default: false },
    linkedin: { type: Boolean, default: false },
    email: { type: Boolean, default: true },
    custom: { type: [CustomShareButtonSchema], default: [] },
  },
  { _id: false },
);

const VendorNotificationPreferencesSchema = new Schema(
  {
    newOrders: { type: Boolean, default: true },
    orderUpdates: { type: Boolean, default: true },
    lowStock: { type: Boolean, default: true },
    marketing: { type: Boolean, default: false },
  },
  { _id: false },
);

const VendorPayoutSettingsSchema = new Schema(
  {
    schedule: {
      type: String,
      enum: ["weekly", "biweekly", "monthly"],
      default: "weekly",
    },
    minimumAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  { _id: false },
);

/**
 * Per-vendor shipping profile. Mirrors the platform shipping shape (zones,
 * rates, fallback, local pickup) so the shared engine can rate a vendor's
 * items against their own rules when admin enables vendor shipping.
 */
const VendorShippingRateSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["flat", "free_over", "subtotal_range", "weight_range"],
      default: "flat",
    },
    price: { type: Number, default: 0 },
    freeOver: Number,
    minSubtotal: Number,
    maxSubtotal: Number,
    minWeight: Number,
    maxWeight: Number,
    pricePerWeightUnit: Number,
    minDays: Number,
    maxDays: Number,
    active: { type: Boolean, default: true },
  },
  { _id: false },
);

/**
 * Legacy: a geography this vendor drew for itself. Superseded by `zoneRates`,
 * which prices the platform's zones instead. Kept so profiles written before
 * that change keep rating until `scripts/migrate-vendor-zone-rates.ts` maps
 * them across.
 */
const VendorShippingZoneSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    countries: { type: [String], default: [] },
    regions: { type: [String], default: [] },
    rates: { type: [VendorShippingRateSchema], default: [] },
  },
  { _id: false },
);

/** This vendor's prices for one platform zone, keyed by that zone's id. */
const VendorZoneRatesSchema = new Schema(
  {
    zoneId: { type: String, required: true },
    rates: { type: [VendorShippingRateSchema], default: [] },
  },
  { _id: false },
);

const VendorPickupLocationSchema = new Schema(
  {
    id: { type: String, required: true, maxlength: 100 },
    name: { type: String, required: true, maxlength: 120 },
    enabled: { type: Boolean, default: true },
    pickupArea: { type: String, maxlength: 160 },
    pickupAddress: { type: String, maxlength: 500 },
    instructions: { type: String, maxlength: 1000 },
    timeZone: { type: String, maxlength: 100 },
    weeklyHours: {
      type: [
        new Schema(
          {
            weekday: { type: Number, min: 0, max: 6 },
            enabled: { type: Boolean, default: false },
            start: String,
            end: String,
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    blackoutDates: { type: [String], default: [] },
  },
  { _id: false },
);

/**
 * A vendor's own carrier account.
 *
 * Tokens are encrypted at rest — unlike the platform's, which sit in plaintext
 * alongside every other settings credential. The blast radius differs: `Vendor`
 * documents are populated into storefront queries in many places, and
 * `GET /api/vendor/settings` returns `shipping` verbatim, so a plaintext token
 * here is one forgotten `.select()` away from leaking.
 */
const VendorCarrierSecretSchema = new Schema(
  {
    version: { type: Number, enum: [1] },
    algorithm: { type: String, enum: ["aes-256-gcm"] },
    iv: String,
    ciphertext: String,
    authTag: String,
  },
  { _id: false },
);

const VendorCarriersSchema = new Schema(
  {
    // "platform" (the default) means this vendor ships on the store's account.
    mode: { type: String, enum: ["platform", "own"], default: "platform" },
    shippo: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false },
          mode: { type: String, enum: ["test", "live"], default: "test" },
          testToken: { type: VendorCarrierSecretSchema, default: undefined },
          liveToken: { type: VendorCarrierSecretSchema, default: undefined },
        },
        { _id: false },
      ),
      default: undefined,
    },
    shiprocket: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false },
          email: String,
          password: { type: VendorCarrierSecretSchema, default: undefined },
          pickupLocationName: String,
        },
        { _id: false },
      ),
      default: undefined,
    },
  },
  { _id: false },
);

const VendorShippingSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    weightUnit: { type: String, enum: ["kg", "lb"], default: "kg" },
    carriers: { type: VendorCarriersSchema, default: undefined },
    /**
     * Whether THIS vendor takes the COD cash themselves or the platform's
     * courier does. `inherit` (the default) defers to
     * `settings.shipping.codCollectedBy`.
     *
     * It decides which way money moves on every COD sale this vendor makes —
     * their own van means they hold the cash and owe commission, the store's
     * courier means the platform holds it and owes them their earnings — so it
     * is resolved and frozen onto each consignment at checkout rather than
     * read back here, where a later edit would rewrite history.
     */
    codCollectedBy: {
      type: String,
      enum: [...Object.values(COD_COLLECTED_BY), COD_COLLECTED_BY_INHERIT],
      default: COD_COLLECTED_BY_INHERIT,
    },
    origin: {
      type: new Schema(
        {
          country: { type: String, default: "" },
          state: String,
          city: String,
          postalCode: String,
          address1: String,
          address2: String,
        },
        { _id: false },
      ),
      default: undefined,
    },
    delivery: {
      type: new Schema(
        {
          processingDaysMin: { type: Number, default: 0 },
          processingDaysMax: { type: Number, default: 0 },
          showEstimatedDelivery: { type: Boolean, default: true },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    zones: { type: [VendorShippingZoneSchema], default: [] },
    zoneRates: { type: [VendorZoneRatesSchema], default: [] },
    fallbackRate: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false },
          name: { type: String, default: "Standard" },
          price: { type: Number, default: 0 },
          minDays: Number,
          maxDays: Number,
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    localPickup: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false },
          locations: { type: [VendorPickupLocationSchema], default: [] },
          pickupArea: String,
          pickupAddress: String,
          instructions: String,
          readyInDaysMin: Number,
          readyInDaysMax: Number,
          timeZone: String,
          minLeadMinutes: Number,
          maxAdvanceDays: Number,
          slotDurationMinutes: Number,
          capacityPerSlot: Number,
          weeklyHours: {
            type: [
              new Schema(
                {
                  weekday: { type: Number, min: 0, max: 6 },
                  enabled: { type: Boolean, default: false },
                  start: String,
                  end: String,
                },
                { _id: false },
              ),
            ],
            default: [],
          },
          blackoutDates: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
  },
  { _id: false },
);

/**
 * Vendor Schema
 */
const VendorSchema = new Schema<IVendor>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    storeName: {
      type: String,
      required: [true, "Store name is required"],
      trim: true,
      maxlength: [100, "Store name cannot exceed 100 characters"],
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
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    logo: {
      type: String,
    },
    banner: {
      type: String,
    },
    status: {
      type: String,
      enum: Object.values(VENDOR_STATUS),
      default: VENDOR_STATUS.PENDING,
    },
    // Store activation, orthogonal to `status`. False = store hidden from the
    // storefront and blocked from taking NEW orders (e.g. after a paid plan
    // lapses), while an `approved` vendor can still manage existing orders.
    // Defaults true so all existing vendors stay active with no migration.
    storeActive: {
      type: Boolean,
      default: true,
    },
    // The storefront's "Verified vendor" badge, and nothing else. Awarded by an
    // admin only — approval, an uploaded document or a paid plan must never
    // grant it on their own, because the badge is a claim the platform makes to
    // buyers about a seller it has actually checked. Defaults false: a store
    // that nobody has vetted simply shows no badge.
    verified: {
      type: Boolean,
      default: false,
    },
    /**
     * Whether this vendor may open pre-orders.
     *
     * Only consulted when `settings.preorder.requireVendorApproval` is on. It
     * is absent on every vendor that predates the field, which is why the
     * setting defaults to off: switching it on is the moment a store decides
     * to review its sellers, and until then nobody's listings change.
     *
     * `requestedAt` is what puts a vendor in the admin's approval queue —
     * `approvedAt` without it is an admin granting access unprompted, which is
     * fine and stays out of the queue.
     */
    preorder: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false },
          requestedAt: { type: Date },
          approvedAt: { type: Date },
          approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
          /** Why access was granted or refused — shown to the next admin. */
          note: { type: String, trim: true, maxlength: 500 },
        },
        { _id: false },
      ),
      default: undefined,
    },
    commission: {
      type: Number,
      default: DEFAULT_VENDOR_COMMISSION_RATE,
      min: [0, "Commission cannot be negative"],
      max: [100, "Commission cannot exceed 100%"],
    },
    /**
     * Where the number above came from.
     *
     * `commission` is a bare number, so a bulk re-projection could not tell a
     * rate that is merely the store default from one an admin deliberately
     * typed for this vendor — and raising the platform rate would have silently
     * erased every negotiated deal. This says which it is, so a sweep can move
     * the defaults and leave the rest alone.
     *
     * Absent means "default": every row that predates this field was written by
     * a path that projected the settings rate or a plan's, never by hand, so
     * treating the gap as a default is both true and what makes the first sweep
     * work with no backfill.
     */
    commissionSource: {
      type: String,
      enum: ["default", "plan", "manual"],
      index: true,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    totalSales: {
      type: Number,
      default: 0,
      min: 0,
    },
    /**
     * LEGACY per-vendor grant list. Superseded by `permissionOverrides`, which
     * stores deviations from the plan's entitlement rather than a full copy of
     * it — see docs/VENDOR_PERMISSIONS_GUIDELINE.md §2.3.
     *
     * Still read (and only read) by `resolveVendorAccess` when a row has no
     * `permissionOverrides` yet, so deploying the new model revokes nothing.
     * `scripts/migrate-vendor-permission-overrides.mjs` converts the rows;
     * this field goes away once every vendor carries overrides.
     *
     * No `enum`, deliberately. The list is historical data that nothing writes,
     * and constraining it would make a permission impossible to retire: an old
     * row still holding a removed string would fail validation the next time
     * anything saved that vendor for an unrelated reason. `resolveVendorAccess`
     * ignores strings it does not recognise, so a stale value is inert.
     *
     * @deprecated do not write. Write `permissionOverrides` instead.
     */
    permissions: {
      type: [String],
      default: DEFAULT_VENDOR_PERMISSIONS,
    },
    /**
     * Deviations from the plan's entitlement, one row per permission.
     *
     * Deliberately deltas, not a projected result: effective access is derived
     * on every read, so a plan change needs no reconciliation sweep and cannot
     * drift. Each entry carries who made it and why, because that is what an
     * audit of "why can this vendor do that" actually needs.
     *
     * An explicit empty array means "on the new model, no deviations" — it is
     * NOT the same as absent, which means "not migrated yet".
     */
    permissionOverrides: {
      type: [VendorPermissionOverrideSchema],
      default: undefined,
    },
    bankDetails: {
      type: BankDetailsSchema,
    },
    address: {
      type: AddressSchema,
    },
    documents: {
      type: VendorDocumentsSchema,
    },
    // Admin-only internal notes. Never surfaced on the storefront.
    notes: {
      type: String,
      maxlength: [5000, "Notes cannot exceed 5000 characters"],
    },
    // Answers to admin-defined custom onboarding fields, keyed by field key.
    // System fields still land in their own typed columns; this bag holds only
    // the custom-builder fields. Mixed because the shape is admin-defined.
    onboardingResponses: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    // Which subscription plan the vendor is on (provenance). The effective
    // commission it implies is projected onto `commission` above; the money
    // path reads that number, never this field.
    planId: {
      type: Schema.Types.ObjectId,
      ref: "VendorPlan",
      default: null,
    },
    stripeCustomerId: {
      type: String,
      default: null,
    },
    socialLinks: {
      type: SocialLinksSchema,
    },
    socialProfiles: {
      type: [VendorSocialProfileSchema],
      default: undefined,
    },
    shareSettings: {
      type: VendorShareSettingsSchema,
      default: () => ({}),
    },
    notificationPreferences: {
      type: VendorNotificationPreferencesSchema,
      default: () => ({}),
    },
    payoutSettings: {
      type: VendorPayoutSettingsSchema,
      default: () => ({}),
    },
    storeVisibility: {
      type: VendorStoreVisibilitySchema,
      default: () => ({}),
    },
    messaging: {
      type: VendorMessagingSchema,
      default: () => ({}),
    },
    shipping: {
      type: VendorShippingSchema,
      default: undefined,
    },
    // Short-lived claim serializing payout creation for this vendor. Two
    // payouts built at once each read the other's overpayment recovery and
    // commission deduction as not yet taken, and both took them. Stale claims
    // (a crashed request) expire on their own.
    payoutLockAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes
VendorSchema.index({ status: 1 });
VendorSchema.index({ isDefault: 1 });
// Admin vendor list sorts by createdAt with no equality filter — needs its own
// index or it sorts the whole collection in memory.
VendorSchema.index({ createdAt: -1 });
VendorSchema.index({ storeName: "text", description: "text" });
// Radius search for the storefront's location filter. Sparse because most of a
// marketplace's vendors may never geocode successfully, and a 2dsphere index
// rejects a document whose indexed field is present but malformed — sparse
// keeps those rows out of the index instead of failing their save.
VendorSchema.index({ "address.geo": "2dsphere" }, { sparse: true });
// The city-name fallback for vendors with no usable coordinates. Paired with
// status/storeActive because the storefront never resolves a city without also
// constraining to approved, live stores.
VendorSchema.index({ "address.city": 1, status: 1, storeActive: 1 });

// Virtual for user
VendorSchema.virtual("user", {
  ref: "User",
  localField: "userId",
  foreignField: "_id",
  justOne: true,
});

// Virtual for products
VendorSchema.virtual("products", {
  ref: "Product",
  localField: "_id",
  foreignField: "vendorId",
});

export const Vendor = models.Vendor || model<IVendor>("Vendor", VendorSchema);
