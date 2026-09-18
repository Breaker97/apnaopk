import type { Types } from "mongoose";
import type {
  UserRole,
  UserAccountStatus,
  CodCollectedBy,
  OrderStatus,
  PaymentStatus,
  ProductStatus,
  VendorStatus,
} from "@/config/app.config";
import type { VendorPermission } from "@/config/permissions.config";
import type { ShareSettings } from "@/lib/site-config/share-config";
import type { VendorStoreVisibility } from "@/lib/vendors/vendor-address";
import type { SocialProfile } from "@/lib/site-config/social-profiles";
import type { VendorMessagingSettings } from "@/lib/notifications/vendor-messaging";

// ============================================
// Common Types
// ============================================

export interface Address {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  street: string;
  city: string;
  state?: string;
  apartment?: string;
  postalCode: string;
  country: string;
  phone?: string;
  isDefault?: boolean;
  label?: "home" | "work" | "other";
  /**
   * Geocoded position for this address, written on save. Optional throughout:
   * a lookup can fail or the address can predate the field, and both cases fall
   * back to a text map query rather than blocking the save.
   */
  coordinates?: {
    lat: number;
    lng: number;
    formatted?: string;
    geocodedAt?: string;
  };
  /**
   * The same point as `coordinates`, in the GeoJSON shape MongoDB's 2dsphere
   * index requires for radius search. Written alongside rather than replacing
   * `coordinates`, whose `{ lat, lng }` shape the storefront map link reads.
   *
   * Note the axis order: GeoJSON is [longitude, latitude]. Build and read this
   * only through `lib/locations/vendor-geo.ts` — a swap here does not throw, it
   * silently moves a vendor to the wrong hemisphere.
   */
  geo?: {
    type: "Point";
    coordinates: [number, number];
  };
}

export interface BankDetails {
  accountName: string;
  accountNumber: string;
  bankName: string;
  routingNumber?: string;
  swiftCode?: string;
}

// ============================================
// User Types
// ============================================

/**
 * Saved progress for the vendor registration wizard.
 * Lives on the User so onboarding is resumable across sessions without
 * creating a half-formed Vendor document. Cleared once the application is
 * submitted (a real Vendor is created at that point).
 */
interface VendorOnboardingDraftPlan {
  planId?: string;
  billingInterval?: "monthly" | "yearly" | "none";
  startTrial?: boolean;
}

export interface VendorOnboardingDraft {
  /** Legacy numeric step (pre-registry). Kept for back-compat/migration. */
  step?: number;
  /** Stable step key — survives a change in how many steps exist. */
  stepKey?: string;
  storeName?: string;
  description?: string;
  country?: string;
  state?: string;
  city?: string;
  address?: string;
  pincode?: string;
  phone?: string;
  phoneCode?: string;
  documents?: VendorDocuments;
  /** Answers to admin-defined custom onboarding fields, keyed by field key. */
  responses?: Record<string, string | boolean>;
  /** Chosen subscription plan (when the plan step is shown). */
  plan?: VendorOnboardingDraftPlan;
  updatedAt?: Date;
}

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  emailVerified: boolean;
  emailVerifiedAt?: Date;
  emailVerificationRequiredAt?: Date;
  emailVerificationAudience?: "customer" | "vendor";
  image?: string;
  role: UserRole;
  roles: UserRole[];
  status: UserAccountStatus;
  phone?: string;
  addresses: Address[];
  vendorOnboarding?: VendorOnboardingDraft;
  // 2FA fields
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
  /** Stripe Customer for this shopper — see `lib/payments/stripe-customer.ts`. */
  stripeCustomerId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Admin Profile Types
// ============================================

// ============================================
// Customer Profile Types
// ============================================

export type LoyaltyTier = "bronze" | "silver" | "gold" | "platinum";

interface EmailNotificationPreferences {
  orderUpdates: boolean;
  promotions: boolean;
  newsletter: boolean;
  priceDrops: boolean;
  backInStock: boolean;
}

export interface CustomerStats {
  totalOrders: number;
  totalSpent: number;
  averageOrderValue: number;
  lastOrderDate?: Date;
  totalReviews: number;
  averageRating?: number;
  totalWishlistItems: number;
}

export interface ICustomerProfile {
  _id: Types.ObjectId;
  /** Absent on guest rows — a customer record with no login behind it. */
  userId?: Types.ObjectId;

  /** Guest identity, present only until the row is claimed by a registration. */
  isGuest?: boolean;
  email?: string;
  name?: string;

  // Loyalty & Rewards
  loyaltyPoints: number;
  loyaltyTier: LoyaltyTier;
  lifetimePoints: number;

  // Shopping Preferences
  preferredPaymentMethod?: string;
  preferredCurrency?: string;
  preferredLanguage?: string;
  preferredCategories?: Types.ObjectId[];
  sizePreferences?: Record<string, string>;

  // Marketing & Communication
  marketingOptIn: boolean;
  emailNotifications: EmailNotificationPreferences;
  /** Covers order, pre-order and return texts. Absent on profiles saved before SMS. */
  smsNotifications?: { orderUpdates: boolean };

  // Cached Aggregated Stats
  stats: CustomerStats;

  // Customer Segments / Tags
  tags?: string[];
  notes?: string;

  // Source & Acquisition
  acquisitionSource?: string;
  referredBy?: Types.ObjectId;
  shippingAddress?: Address;

  // Activity
  lastActiveAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Vendor Types
// ============================================

/**
 * Verification documents supplied during vendor registration.
 * Every field is optional — documents can be submitted at signup or
 * provided to an admin later.
 */
export interface VendorDocuments {
  businessLicense?: string;
  taxId?: string;
  taxCertificate?: string;
  governmentId?: string;
}

export interface IVendor {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  isDefault?: boolean;
  storeName: string;
  slug: string;
  description?: string;
  logo?: string;
  banner?: string;
  status: VendorStatus;
  /**
   * Store activation, orthogonal to `status`. An approved vendor whose paid
   * subscription lapses is deactivated (storeActive=false): the store is hidden
   * from the storefront and takes no NEW orders, but the vendor keeps their
   * `approved` status so they can still log in and manage existing/pending
   * orders. Reactivated when a plan is re-assigned. Absent/true = active.
   */
  storeActive?: boolean;
  /**
   * Whether an admin has vetted this seller. Drives the storefront's "Verified
   * vendor" badge and nothing else — it is never derived from `status`,
   * documents or a subscription. Absent/false = no badge.
   */
  verified?: boolean;
  /**
   * Pre-order access. Only consulted when
   * `settings.preorder.requireVendorApproval` is on — see the vendor model.
   */
  preorder?: {
    enabled?: boolean;
    requestedAt?: Date;
    approvedAt?: Date;
    approvedBy?: Types.ObjectId | string;
    note?: string;
  };
  commission: number;
  /**
   * Whether `commission` is the store default, a plan's rate, or a per-vendor
   * override an admin typed. Absent reads as "default" — see the model.
   */
  commissionSource?: "default" | "plan" | "manual";
  /** Claim serializing payout creation — see the model. */
  payoutLockAt?: Date;
  rating: number;
  totalSales: number;
  /** @deprecated legacy grant list; read only as a fallback. See `permissionOverrides`. */
  permissions: VendorPermission[];
  /**
   * Deviations from the plan's entitlement. Effective access is derived from
   * plan packs ± these on every read — see lib/vendor-permissions.ts.
   */
  permissionOverrides?: {
    permission: VendorPermission;
    mode: "grant" | "revoke";
    reason?: string;
    grantedBy?: string;
    grantedAt?: Date;
    expiresAt?: Date | null;
  }[];
  bankDetails?: BankDetails;
  address?: Address;
  documents?: VendorDocuments;
  /** Admin-only internal notes; never exposed on the storefront. */
  notes?: string;
  /**
   * Answers to admin-defined custom onboarding fields, keyed by field key.
   * Self-describing ({label, value}) so the admin view survives later edits or
   * deletion of the field definition.
   */
  onboardingResponses?: Record<
    string,
    { label: string; value: string | boolean }
  >;
  /** Subscription plan the vendor is on (provenance); commission is cached in `commission`. */
  planId?: Types.ObjectId | null;
  /** Stripe customer created for vendor subscription billing, when applicable. */
  stripeCustomerId?: string | null;
  socialLinks?: {
    website?: string;
    /** @deprecated Superseded by `socialProfiles`; still read as a fallback. */
    facebook?: string;
    /** @deprecated Superseded by `socialProfiles`. */
    instagram?: string;
    /** @deprecated Superseded by `socialProfiles`. */
    twitter?: string;
  };
  /** Vendor-chosen social profiles shown on the storefront. */
  socialProfiles?: SocialProfile[];
  shareSettings?: ShareSettings;
  notificationPreferences?: {
    newOrders?: boolean;
    orderUpdates?: boolean;
    lowStock?: boolean;
    marketing?: boolean;
  };
  payoutSettings?: {
    schedule?: "weekly" | "biweekly" | "monthly";
    minimumAmount?: number;
  };
  /**
   * What the storefront may publish about this store. `address` above is
   * collected for payouts/KYC, so revealing it is opt-in and graded — see
   * `lib/vendor-address.ts`. Absent = the safe default (city + country, no
   * phone), which is what every pre-existing vendor gets.
   */
  storeVisibility?: VendorStoreVisibility;
  /** Buyer-facing direct messaging channels configured by this vendor. */
  messaging?: VendorMessagingSettings;
  shipping?: VendorShippingProfile;
  createdAt: Date;
  updatedAt: Date;
}

export interface VendorShippingRate {
  id: string;
  name: string;
  type: "flat" | "free_over" | "subtotal_range" | "weight_range";
  price: number;
  freeOver?: number;
  minSubtotal?: number;
  maxSubtotal?: number;
  minWeight?: number;
  maxWeight?: number;
  pricePerWeightUnit?: number;
  minDays?: number;
  maxDays?: number;
  active: boolean;
}

/**
 * Legacy per-vendor geography, superseded by {@link VendorZoneRates}. Vendors
 * now price the platform's zones rather than drawing their own.
 */
interface VendorShippingZone {
  id: string;
  name: string;
  countries: string[];
  regions?: string[];
  rates: VendorShippingRate[];
}

/** A vendor's prices for one platform zone, keyed by that zone's id. */
export interface VendorZoneRates {
  zoneId: string;
  rates: VendorShippingRate[];
}

/** Encrypted at rest; see `lib/secret-box.ts`. */
export interface VendorEncryptedSecret {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  authTag: string;
}

export interface VendorCarrierSettings {
  /** "platform" ships on the store's account; "own" uses these credentials. */
  mode: "platform" | "own";
  shippo?: {
    enabled: boolean;
    mode: "test" | "live";
    testToken?: VendorEncryptedSecret;
    liveToken?: VendorEncryptedSecret;
  };
  shiprocket?: {
    enabled: boolean;
    email?: string;
    password?: VendorEncryptedSecret;
    pickupLocationName?: string;
  };
}

export interface VendorShippingProfile {
  enabled: boolean;
  weightUnit?: "kg" | "lb";
  carriers?: VendorCarrierSettings;
  origin?: {
    country: string;
    state?: string;
    city?: string;
    postalCode?: string;
    address1?: string;
    address2?: string;
  };
  delivery?: {
    processingDaysMin: number;
    processingDaysMax: number;
    showEstimatedDelivery: boolean;
  };
  zones: VendorShippingZone[];
  /**
   * What this vendor charges inside each of the store's zones. A zone with no
   * entry here inherits the store's own rates for it.
   */
  zoneRates: VendorZoneRates[];
  fallbackRate?: {
    enabled: boolean;
    name: string;
    price: number;
    minDays?: number;
    maxDays?: number;
  };
  localPickup?: {
    enabled: boolean;
    /**
     * Stable vendor-managed pickup branches. Phase 1 uses these IDs for slot
     * capacity; Phase 2 will also use them for branch inventory.
     */
    locations?: Array<{
      id: string;
      name: string;
      enabled: boolean;
      pickupArea?: string;
      pickupAddress?: string;
      instructions?: string;
      timeZone?: string;
      weeklyHours?: Array<{
        weekday: number;
        enabled: boolean;
        start: string;
        end: string;
      }>;
      blackoutDates?: string[];
    }>;
    /** Legacy single-location fields retained for migration-safe reads. */
    pickupArea?: string;
    pickupAddress?: string;
    instructions?: string;
    readyInDaysMin?: number;
    readyInDaysMax?: number;
    timeZone?: string;
    minLeadMinutes?: number;
    maxAdvanceDays?: number;
    slotDurationMinutes?: number;
    capacityPerSlot?: number;
    weeklyHours?: Array<{
      weekday: number;
      enabled: boolean;
      start: string;
      end: string;
    }>;
    blackoutDates?: string[];
  };
}

// ============================================
// Category Types
// ============================================

interface CategorySEO {
  pageTitle?: string;
  metaDescription?: string;
  tags?: string[];
}

export interface ICategory {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  icon?: string;
  parentId?: Types.ObjectId;
  order: number;
  isActive: boolean;
  featured: boolean;
  seo?: CategorySEO;
  productCount: number;
  // Reusable variant option template (e.g. Color: Red/Blue, Size: xl). Defines
  // options + values only — no per-variant pricing/stock/images — so products
  // assigned to this category can inherit these options. Same shape as a
  // product's own `options`.
  options?: ProductOption[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Brand Types
// ============================================

interface BrandSEO {
  pageTitle?: string;
  metaDescription?: string;
}

type BrandApprovalStatus = "approved" | "pending" | "rejected";

export interface IBrand {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  website?: string;
  order: number;
  isActive: boolean;
  featured: boolean;
  seo?: BrandSEO;
  productCount: number;
  // Multi-vendor moderation: null = platform/admin-owned ("official") brand,
  // otherwise the vendor that created it. Vendor-created brands enter a
  // moderation queue (pending) and are owner-scoped for edits.
  ownerVendorId?: Types.ObjectId | null;
  approvalStatus: BrandApprovalStatus;
  rejectionReason?: string;
  // Soft-delete marker. Admin-only; non-null means archived/hidden everywhere
  // but recoverable, so product references survive.
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Product Types
// ============================================

export interface ProductAttribute {
  name: string;
  value: string;
}

type WeightUnit = "g" | "kg" | "lb" | "oz";
type UnitPriceUnit = "item" | "g" | "kg" | "lb" | "oz" | "ml" | "l";

interface UnitPriceMeasurement {
  totalAmount: number;
  totalUnit: UnitPriceUnit;
  baseAmount: number;
  baseUnit: UnitPriceUnit;
}

type MediaType = "image" | "video" | "model" | "external_video";

const PRODUCT_MEDIA_FITS = ["auto", "contain", "cover"] as const;
export type ProductMediaFit = (typeof PRODUCT_MEDIA_FITS)[number];

export interface ProductMedia {
  _id: string;
  type: MediaType;
  url: string;
  filename?: string;
  alt?: string;
  position?: number;
  mimeType?: string;
  /** Bytes, and intrinsic pixel dimensions for images/videos. */
  size?: number;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  /** external_video only: embed provider + parsed video id. */
  provider?: "youtube" | "vimeo";
  embedId?: string;
  /**
   * How this image sits in the product page's frames: "auto" follows the
   * page's Image fit setting, "contain" floats it inside with air around it
   * (a cut-out on a transparent background), "cover" fills the frame edge to
   * edge (a lifestyle shot). Images only.
   */
  fit?: ProductMediaFit;
}

/**
 * A digital deliverable attached to a product (ebook, license, zip, …).
 * storageKey points into PRIVATE storage and must never be exposed to the
 * storefront — customers download via the order-gated route only.
 */
interface ProductDigitalAsset {
  _id: string;
  filename: string;
  storageKey: string;
  size?: number;
  mimeType?: string;
  position?: number;
}

// Option value structure for product options
interface OptionValue {
  _id: string;
  value: string;
  colorCode?: string;
  position: number;
}

// Updated ProductOption with id, position, and structured values
export interface ProductOption {
  _id: string;
  name: string;
  // Storefront presentation hint (swatch / dropdown / radio …). Optional:
  // when absent the storefront falls back to name-based detection.
  visual?: GlobalVariantVisual;
  values: OptionValue[];
  position: number;
}

// ============================================
// Global Variant Types
// ============================================
// A reusable variant definition created once and attached to any product,
// so option sets like "Color" or "Storage" don't have to be re-typed per
// product. Rendered on the product form's variant picker and stored at the
// store level.

// Data type of a global variant's values.
export type GlobalVariantType =
  | "text"
  | "color"
  | "image"
  | "integer"
  | "decimal";

// How the variant is presented to the storefront shopper.
export type GlobalVariantVisual =
  | "rectangle"
  | "dropdown"
  | "circle"
  | "color"
  | "color_label"
  | "radio"
  | "image";

export interface GlobalVariantValue {
  _id: string;
  value: string;
  // Set when `type` is "color" — hex swatch shown next to the value.
  colorCode?: string;
  // Set when `type` is "image" — media URL shown as the value's thumbnail.
  image?: string;
  position: number;
}

export interface IGlobalVariant {
  _id: Types.ObjectId;
  name: string;
  type: GlobalVariantType;
  visual: GlobalVariantVisual;
  values: GlobalVariantValue[];
  position: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ProductSEO {
  pageTitle?: string;
  metaDescription?: string;
  handle?: string;
}

/**
 * The derived search block every product carries — see
 * lib/products/search.ts. `v` is the builder version that produced it.
 */
export interface ProductSearchIndex {
  v: number;
  /** The normalized name, stop words removed; what the ranking reads. */
  name: string;
  /** Prefix-matchable words from the primary fields; indexed. */
  terms: string[];
  /** `terms` plus the description words, one string; the unindexed fallback. */
  text: string;
}

// Money range used for `priceRange` and `compareAtPriceRange` (Shopify-style)
interface MoneyRange {
  min: number;
  max: number;
}

interface ProductPublishing {
  onlineStore: boolean;
  pointOfSale: boolean;
}

type ProductSource = "admin" | "vendor";

interface ProductInventory {
  tracked: boolean;
  quantity: number;
  continueSellingWhenOutOfStock: boolean;
}

/**
 * Product-level stock policy (the Inventory card's two switches). No
 * `quantity`: product stock lives in `stock` / `locationInventory`.
 * Interpret it with the helpers in lib/products/stock-policy.ts.
 */
interface ProductStockPolicy {
  tracked: boolean;
  continueSellingWhenOutOfStock: boolean;
}

export interface IInventoryLocation {
  _id: Types.ObjectId;
  /**
   * Owning merchant. Every location belongs to exactly one vendor — in
   * single-vendor mode that is the default vendor, which is also who the admin
   * acts as. Optional only so documents written before this field existed keep
   * loading; `lib/inventory-location-scope.ts` treats an absent owner as
   * unowned-legacy and the backfill script assigns one.
   */
  vendorId?: Types.ObjectId;
  name: string;
  address?: string;
  isDefault: boolean;
  isActive: boolean;

  /**
   * The public may collect orders here. A warehouse answers no — deriving this
   * from stock instead would publish every fulfilment centre as a pickup point.
   */
  pickupEnabled?: boolean;
  /**
   * Delivery orders may be dispatched from here. Off for a collection counter
   * that only hands over what was brought to it.
   *
   * The third capability, and the one that answers "where does a posted order
   * leave from" — a question `pickupEnabled` cannot, since the two are
   * genuinely independent: a shop floor does both, a warehouse only this, a
   * market stall only the other.
   */
  fulfillsOnlineOrders?: boolean;
  /**
   * A register may stand here — the counter this branch sells over.
   *
   * The third capability, and the only one that can answer it: a collection
   * point admits the public but rings nothing up, a shop floor with collection
   * off still has a till, and `fulfillsOnlineOrders` defaults true so it says
   * yes about almost every row. See `lib/locations/counter-location.ts`.
   */
  sellsAtCounter?: boolean;
  /**
   * Where this branch sits in the merchant's dispatch order. Lower goes first;
   * ties fall back to `isDefault` and then name.
   *
   * An ordered list rather than "nearest to the customer": nearest needs every
   * delivery address geocoded and produces dispatch decisions a merchant cannot
   * predict, where "try the warehouse, then the shop" is one drag-to-reorder
   * control they can reason about. Shopify calls the same thing a fulfillment
   * priority list.
   */
  fulfillmentPriority?: number;

  /** Shown before an order exists; the exact `address` is withheld until after. */
  pickupArea?: string;
  instructions?: string;
  weeklyHours?: Array<{
    weekday: number;
    enabled: boolean;
    start: string;
    end: string;
  }>;

  /**
   * The map link the merchant pasted to place this branch's pin, kept verbatim.
   *
   * Stored so the form can show back what they entered, and so an unrelated
   * edit — renaming, fixing a typo in the address — re-derives the same point
   * instead of silently reverting to the vendor's registered address.
   */
  mapsUrl?: string;

  /**
   * GeoJSON `[longitude, latitude]`. Build and read only through
   * `lib/locations/vendor-geo.ts` — a swapped axis does not throw, it silently
   * moves the branch to the wrong hemisphere.
   */
  geo?: {
    type: "Point";
    coordinates: [number, number];
  };

  createdAt: Date;
  updatedAt: Date;
}

export interface LocationInventory {
  locationId: Types.ObjectId | string;
  locationName?: string;
  quantity: number;
}

interface PreorderSettings {
  enabled?: boolean;
  releaseDate?: Date | string;
  message?: string;
  limit?: number;
  reservedQuantity?: number;
  preorderOnly?: boolean;
  autoConvert?: boolean;
  paymentMode?: "full" | "deposit" | "pay_later";
  depositType?: "percentage" | "fixed";
  depositValue?: number;
  supplierEta?: Date | string;
  batchName?: string;
}

type PurchaseType = "standard" | "preorder";
type PreorderItemStatus =
  | "reserved"
  | "payment_due"
  | "delayed"
  | "partially_ready"
  | "ready"
  | "fulfilled"
  | "cancelled"
  | "expired";

// Variant option value - tracks which option/value combination a variant has
interface VariantOptionValue {
  optionId: string;
  optionName: string;
  valueId: string;
  value: string;
  colorCode?: string;
}

export interface ProductVariant {
  _id?: Types.ObjectId | string;
  name: string;
  sku: string;
  skuNormalized?: string;
  barcode?: string;
  barcodeNormalized?: string;
  barcodeFormat?: "ean13" | "upca" | "gtin14" | "code128";
  barcodeSource?: "manufacturer" | "gs1" | "internal";
  price: number;
  comparePrice?: number;
  cost?: number;
  taxable?: boolean;
  stock: number;
  attributes: ProductAttribute[];
  image?: string;
  // Updated: structured option values instead of string array
  optionValues?: VariantOptionValue[];
  inventory?: ProductInventory;
  requiresShipping?: boolean;
  weight?: number;
  weightUnit?: WeightUnit;
  /** Overrides the product's box only when all three axes are set. */
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: "cm" | "in";
  mediaId?: string;
  locationInventory?: LocationInventory[];
  preorder?: PreorderSettings;
}

export interface IProduct {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  productSource: ProductSource;
  name: string;
  title?: string;
  slug: string;
  handle?: string;
  description: string;
  shortDescription?: string;
  price: number;
  comparePrice?: number;
  priceRange?: MoneyRange;
  compareAtPriceRange?: MoneyRange;
  cost?: number;
  unitPrice?: UnitPriceMeasurement;
  unitPriceUnit?: UnitPriceUnit;
  chargeTax?: boolean;
  /**
   * Sell by quote instead of by price. Every storefront surface hides the
   * money and offers "Request a quote" in place of Add to cart, and the cart
   * API refuses the line — see lib/products/quote-pricing.ts.
   */
  priceOnRequest?: boolean;
  /** Merchant's own wording for the quote button. Empty falls back to i18n. */
  quoteButtonLabel?: string;
  sku: string;
  skuNormalized?: string;
  barcode?: string;
  barcodeNormalized?: string;
  barcodeFormat?: "ean13" | "upca" | "gtin14" | "code128";
  barcodeSource?: "manufacturer" | "gs1" | "internal";
  stock: number;
  inventory?: ProductStockPolicy;
  images: string[];
  media?: ProductMedia[];
  digitalAssets?: ProductDigitalAsset[];
  digitalDelivery?: {
    /** Max downloads per order per file; 0 = unlimited. */
    downloadLimit?: number;
  };
  /** Public preview/sample file shown on the product page. */
  digitalPreview?: {
    url: string;
    filename?: string;
    size?: number;
    mimeType?: string;
  };
  category: Types.ObjectId;
  brand?: Types.ObjectId;
  productType?: string;
  collectionIds?: Types.ObjectId[];
  tags: string[];
  attributes: ProductAttribute[];
  options?: ProductOption[];
  variants: ProductVariant[];
  preorder?: PreorderSettings;
  seo?: ProductSEO;
  /** Derived on every write; never set by a caller. */
  search?: ProductSearchIndex;
  publishing?: ProductPublishing;
  shipping?: {
    isPhysicalProduct?: boolean;
    weight?: number;
    weightUnit?: WeightUnit;
    /** Optional parcel size used to pick a shipping box for carrier rating. */
    length?: number;
    width?: number;
    height?: number;
    dimensionUnit?: "cm" | "in";
    countryOfOrigin?: string;
    hsCode?: string;
    customsDescription?: string;
  };
  status: ProductStatus;
  featured: boolean;
  /** Denormalized stamp of the product's active boost campaign. Readers must
   * still filter endsAt > now — the stamp may outlive the campaign by up to
   * one cron interval. */
  rating: number;
  reviewCount: number;
  locationInventory?: LocationInventory[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Cart Types
// ============================================

export interface CartItem {
  _id?: Types.ObjectId | string;
  productId: Types.ObjectId | string;
  variantId?: Types.ObjectId | string;
  quantity: number;
  price: number;
  name: string;
  variantName?: string;
  image?: string;
  purchaseType?: PurchaseType;
  preorderReleaseDate?: Date;
  preorderMessage?: string;
  preorderPaymentMode?: "full" | "deposit" | "pay_later";
  preorderDepositAmount?: number;
  preorderOutstandingAmount?: number;
  preorderSupplierEta?: Date;
  preorderBatchName?: string;
  /**
   * The accepted quote this line is priced by, for a "price on request"
   * product. Its presence is the only reason such a line may sit in a cart at
   * all — every price surface refuses the product otherwise. The price is
   * still re-read from the quote at checkout, never trusted from here.
   */
  quoteId?: Types.ObjectId | string;
  /**
   * Who sells this line. Attached by `GET /api/cart` from the product, never
   * stored on the cart: a cart can outlive a store rename by weeks, and the
   * name a shopper sees should be the one on the store today.
   *
   * Absent on a line whose product has since been deleted, and on every line
   * from a mutation response — only the read endpoint resolves it.
   */
  vendorId?: string;
  vendorName?: string;
}

export interface ICart {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  sessionId?: string;
  items: CartItem[];
  checkoutToken?: string;
  checkoutUrl?: string;
  email?: string;
  phone?: string;
  customerName?: string;
  customerLocale?: string;
  buyerAcceptsMarketing?: boolean;
  billingAddress?: Address;
  shippingAddress?: Address;
  sourceName?: string;
  landingSite?: string;
  referringSite?: string;
  gateway?: string;
  subtotalPrice?: number;
  shippingPrice?: number;
  totalTax?: number;
  totalDiscounts?: number;
  totalPrice?: number;
  presentmentCurrency?: string;
  checkoutStartedAt?: Date;
  abandonedAt?: Date;
  completedAt?: Date;
  recoveryEmailStatus?: "not_sent" | "sent" | "failed" | "not_applicable";
  recoveryStatus?: "not_recovered" | "recovered";
  emailStatusReason?: string;
  orderId?: Types.ObjectId;
  paymentEvents?: Array<{
    gateway?: string;
    status: "created" | "failed" | "succeeded" | "cancelled";
    message?: string;
    paymentId?: string;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  lastActionAt: Date;
  status: "active" | "abandoned" | "recovered";
  recoveryToken?: string;
  emailSentAt?: Date;
  recoveredAt?: Date;
  /** Set atomically while an order-creation request is consuming this cart. */
  checkoutClaimedAt?: Date;
  /** Set by the recovery-email sweep as it claims the cart. */
  recoveryEmailClaimedAt?: Date;
  /** Stripe intents rejected by the tamper guard and auto-refunded — must never fulfil an order. */
  rejectedPaymentIntentIds?: string[];
  /**
   * The order note and checkout-field answers of the latest Stripe checkout,
   * which creates its order later from the webhook — too large and too free
   * to ride in Stripe's 500-character metadata values.
   */
  checkoutDetails?: {
    customerNote?: string;
    contactPhone?: string;
    checkoutFields?: OrderCheckoutField[];
  };
}

// ============================================
// Order Types
// ============================================

export interface OrderItem {
  productId: Types.ObjectId;
  variantId?: Types.ObjectId;
  vendorId: Types.ObjectId;
  name: string;
  sku: string;
  price: number;
  /**
   * Unit cost at the moment of sale. Absent means the seller tracks no cost —
   * never treat it as 0, which would report the full price as margin.
   */
  cost?: number;
  quantity: number;
  image?: string;
  purchaseType?: PurchaseType;
  preorderReleaseDate?: Date;
  preorderMessage?: string;
  preorderStatus?: PreorderItemStatus;
  preorderPaymentMode?: "full" | "deposit" | "pay_later";
  preorderDepositAmount?: number;
  preorderOutstandingAmount?: number;
  preorderSupplierEta?: Date;
  preorderBatchName?: string;
  /** The quote whose offer priced this line, when it came from one. */
  quoteId?: Types.ObjectId;
  customs?: {
    countryOfOrigin?: string;
    hsCode?: string;
    description?: string;
    weight?: number;
    weightUnit?: WeightUnit;
  };
  // Per-line discount (applied before any order-level discount)
  lineDiscount?: {
    type: "percent" | "amount";
    value: number;
    amount: number;
  };
  // Per-line note attached by the cashier
  lineNote?: string;
}

interface OrderShippingMethod {
  name?: string;
  optionId?: string;
  minDays?: number;
  maxDays?: number;
}

interface OrderFulfillment {
  method: "delivery" | "pickup";
  pickup?: {
    vendorId: Types.ObjectId;
    reservationId: Types.ObjectId;
    pickupLocationId?: string;
    pickupLocationName?: string;
    pickupArea?: string;
    pickupAddress: string;
    instructions?: string;
    timeZone: string;
    startAt: Date;
    endAt: Date;
    status: "scheduled" | "ready" | "collected";
    readyAt?: Date;
    collectedAt?: Date;
  };
  /**
   * Which branch a DELIVERY order is dispatched from. Pickup needs no
   * equivalent — `pickup.pickupLocationId` is already the place the goods have
   * to be. Snapshotted by name so a renamed or deleted branch cannot blank the
   * paperwork of everything it ever shipped.
   */
  fulfillmentLocationId?: Types.ObjectId;
  fulfillmentLocationName?: string;
}

interface OrderCustoms {
  dutyAmount: number;
  dutyMode?: "DDP" | "DDU";
  international?: boolean;
  collectedAtCheckout?: boolean;
}

export interface SubOrder {
  _id?: Types.ObjectId;
  vendorId: Types.ObjectId;
  items: OrderItem[];
  subtotal: number;
  commission: number;
  vendorEarnings: number;
  shippingCost?: number;
  shippingMethod?: OrderShippingMethod;
  fulfillment?: OrderFulfillment;
  status: OrderStatus;
  /**
   * Whether THIS vendor's share of the order has been collected. Absent on
   * rows written before the split — read it through
   * `resolveSubOrderPaymentStatus`, never directly.
   */
  paymentStatus?: PaymentStatus;
  paidAt?: Date;
  /** This consignment's slice of a scoped coupon; absent means shared by sales. */
  couponDiscount?: number;
  /** What a free-shipping coupon took off this consignment's delivery. */
  shippingDiscount?: number;
  /** When this consignment's share was refunded on its cancellation. */
  cancelRefundClaimedAt?: Date;
  /** User id of whoever marked it collected; unset for gateway settlement. */
  paymentCollectedBy?: string;
  /**
   * Whose hands this consignment's COD cash lands in, frozen at checkout.
   * Absent means `vendor`. Read it through `lib/cod-collection.ts`.
   */
  codCollectedBy?: CodCollectedBy;
  /**
   * Who earns this consignment's delivery charge, frozen at checkout. Absent
   * means the store. Read it through `lib/shipping/shipping-revenue.ts`.
   */
  shippingRevenueTo?: "vendor" | "platform";
  /** Set while a label on the store's carrier account covers this parcel. */
  platformLabelAt?: Date;
  trackingNumber?: string;
  /** This vendor's own carrier; the order-level one cannot hold two. */
  carrier?: string;
  shippedAt?: Date;
  deliveredAt?: Date;
  inventoryReserved?: boolean;
  preorderReserved?: boolean;
  payoutStatus?: "unpaid" | "scheduled" | "paid";
  payoutId?: Types.ObjectId;
  payoutClaimedAt?: Date;
  payoutDate?: Date;
  /**
   * When the platform collected its commission on a sale the merchant settled
   * themselves. Absent means uncollected — see the model for why that is the
   * default rather than a stamped status.
   */
  commissionSettledAt?: Date;
  commissionSettlementId?: Types.ObjectId;
  /** When the invoice that claimed this consignment froze its amount. */
  commissionClaimedAt?: Date;
}

export interface OrderLoyaltyState {
  pointsAwarded?: number;
  pointsReversed?: number;
  awardedAt?: Date;
  lastReversedAt?: Date;
}

export interface IOrder {
  _id: Types.ObjectId;
  orderNumber: string;
  customerId: Types.ObjectId;
  /** Email a guest entered at checkout; customerId then points at their cart, not a User. */
  guestEmail?: string;
  items: OrderItem[];
  subOrders: SubOrder[];
  /** Download counters for digital deliverables, keyed by digitalAssets._id. */
  digitalDownloads?: {
    assetId: string;
    count: number;
    lastDownloadedAt?: Date;
  }[];
  shippingAddress: Address;
  billingAddress?: Address;
  /**
   * True when no item needs physical shipping; shippingAddress then holds a
   * copy of the billing address (digital-only checkouts collect billing only).
   */
  digitalOnly?: boolean;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  /** Currency the order was charged in, frozen at creation. */
  currency?: string;
  /**
   * Denormalized running total of succeeded refunds; written atomically by the
   * refund endpoints so concurrent refunds can't exceed the order total.
   * Absent on legacy orders (seeded from PaymentTransaction on first refund).
   */
  refundedTotal?: number;
  /**
   * Immutable award and cumulative reversal state for this order. Keeping it
   * alongside the financial record makes gateway retries idempotent.
   */
  loyalty?: OrderLoyaltyState;
  /** Short-lived claim serializing return-request creation for this order. */
  returnRequestLockAt?: Date;
  /** Short-lived claim serializing refund splits per order. */
  refundLockAt?: Date;
  /** An in-app refund is between its reservation and its row. */
  refundInFlightAt?: Date;
  /** Client-generated idempotency key for POS sales. */
  posClientRequestId?: string;
  /**
   * Provisional receipt number printed at the counter for a sale rung up with
   * no connection. The customer holds this, not `orderNumber`.
   */
  posLocalReceiptNumber?: string;
  /** Lines a replayed offline sale drove negative. See models/order.model.ts. */
  posOversoldLines?: Array<{
    productId?: string;
    variantId?: string;
    name?: string;
    requested?: number;
    available?: number;
  }>;
  /**
   * Gateway fee on this charge, as reported by the gateway. Absent means the
   * gateway did not report one — never 0. See models/order.model.ts.
   */
  paymentFee?: number;
  /** Currency of `paymentFee`; not always the order's own currency. */
  paymentFeeCurrency?: string;
  /**
   * Units of `paymentFeeCurrency` per unit of `currency`, as the gateway
   * computed it — so `paymentFee / paymentFeeRate` is the fee in the order's
   * own currency. Present only on a converted charge.
   */
  paymentFeeRate?: number;
  paymentId?: string;
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  paypalOrderId?: string;
  paypalCaptureId?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  paystackReference?: string;
  paystackTransactionId?: string;
  pesapalOrderTrackingId?: string;
  pesapalMerchantReference?: string;
  pesapalConfirmationCode?: string;
  iotecTransactionId?: string;
  iotecExternalId?: string;
  orangeMoneyOrderId?: string;
  orangeMoneyPayToken?: string;
  orangeMoneyNotifToken?: string;
  orangeMoneyTxnId?: string;
  mtnMomoReferenceId?: string;
  mtnMomoTransactionId?: string;
  mtnMomoPhone?: string;
  subtotal: number;
  shippingCost: number;
  shippingMethod?: OrderShippingMethod;
  fulfillment?: OrderFulfillment;
  customs?: OrderCustoms;
  tax: number;
  discount: number;
  discountMeta?: {
    source?: "pos" | "coupon" | "manual" | "other";
    type?: "percent" | "amount";
    value?: number;
    reason?: string;
    note?: string;
  };
  coupon?: {
    code: string;
    type?: string;
    value?: number;
    /** Who paid for the goods discount; absent means the sellers. */
    fundedBy?: "platform" | "vendor";
  };
  total: number;
  hasPreorder?: boolean;
  preorderStatus?: PreorderItemStatus;
  preorderReleaseDate?: Date;
  preorderReserved?: boolean;
  preorderAcknowledgedAt?: Date;
  /** Card-on-file authorisation for the balance — see the order model. */
  preorderMandateAcceptedAt?: Date;
  preorderMandateText?: string;
  /** The Stripe PaymentMethod kept for the balance. See the order model. */
  preorderSavedPaymentMethodId?: string;
  /** The Stripe Customer that saved card belongs to. See the order model. */
  stripeCustomerId?: string;
  preorderPaymentMode?: "full" | "deposit" | "pay_later";
  preorderDepositAmount?: number;
  preorderOutstandingAmount?: number;
  preorderOriginalReleaseDate?: Date;
  preorderDelayReason?: string;
  preorderReleaseDateUpdatedAt?: Date;
  preorderCustomerNotifiedAt?: Date;
  preorderBalancePaymentIntentId?: string;
  preorderBalancePaidAt?: Date;
  /** The gateway's cut of the balance payment alone. */
  preorderBalancePaymentFee?: number;
  /** When the order's payment was first recorded. */
  paidAt?: Date;
  /** The PayPal order raised to collect the balance — see the order model. */
  preorderBalancePaypalOrderId?: string;
  /** When the balance was asked for — the expiry clock. See the order model. */
  preorderBalanceRequestedAt?: Date;
  /** Dunning state for the card on file — see the order model. */
  preorderBalanceChargeAttempts?: number;
  preorderBalanceLastChargeAt?: Date;
  preorderBalanceLastChargeCode?: string;
  /** Balance-reminder stages already sent — see the order model. */
  preorderBalanceRemindersSent?: string[];
  channel: "online" | "pos";
  posLocationId?: string;
  staffId?: string;
  status: OrderStatus;
  trackingNumber?: string;
  carrier?: string;
  processingAt?: Date;
  shippedAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  statusChangedBy?: string;
  /** Last auto-ship sweep pass; bounds the sweep's scan. */
  autoShipCheckedAt?: Date;
  /** Staff-only internal notes. */
  notes?: string;
  /** The note the shopper left at checkout (checkout settings `orderNote`). */
  customerNote?: string;
  /**
   * The phone the shopper gave to be reached on (checkout settings
   * `contact.mode`) — may differ from the delivery phone on the address.
   */
  contactPhone?: string;
  /**
   * Answers to the store's own checkout fields. Self-describing — the label
   * is snapshotted — so the order still reads right after the field is
   * renamed or deleted.
   */
  checkoutFields?: OrderCheckoutField[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderCheckoutField {
  key: string;
  label: string;
  type: string;
  value: string;
}

// ============================================
// Review Types
// ============================================

interface IReviewReply {
  comment: string;
  userId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IReview {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  userId: Types.ObjectId;
  orderId: Types.ObjectId;
  rating: number;
  title?: string;
  comment: string;
  images?: string[];
  isVerified: boolean;
  isApproved: boolean;
  reply?: IReviewReply;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// API Types
// ============================================

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

// ============================================
// Collection Types
// ============================================

export type CollectionConditionField =
  | "title"
  | "productType"
  | "vendor"
  | "tag"
  | "price"
  | "comparePrice"
  | "weight"
  | "stock"
  | "createdAt"
  | "category";

export type CollectionConditionOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "less_than"
  | "starts_with"
  | "ends_with"
  | "contains"
  | "not_contains"
  | "is_set"
  | "is_not_set";

export interface CollectionCondition {
  field: CollectionConditionField;
  operator: CollectionConditionOperator;
  value: string | number | Date;
}

export type CollectionSortOrder =
  | "manual"
  | "best-selling"
  | "title-asc"
  | "title-desc"
  | "price-asc"
  | "price-desc"
  | "created-asc"
  | "created-desc";

interface CollectionImage {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}

interface CollectionSEO {
  pageTitle?: string;
  metaDescription?: string;
  handle?: string;
}

interface CollectionPublishing {
  onlineStore: boolean;
  pointOfSale: boolean;
}

/**
 * What a collection IS on the storefront. A "look" is a styled outfit — a
 * campaign image and the pieces in it — that the Get the Look and Looks
 * sections merchandise; a plain collection is a shelf.
 */
export type CollectionKind = "collection" | "look";

export interface ICollection {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  handle?: string;
  description?: string;
  descriptionHtml?: string;
  image?: CollectionImage;
  collectionType: "manual" | "automated";
  /** Absent on documents written before Looks existed — read as "collection". */
  kind?: CollectionKind;
  products: Types.ObjectId[];
  conditions: CollectionCondition[];
  conditionMatch: "all" | "any";
  sortOrder: CollectionSortOrder;
  position: number;
  status: "active" | "draft";
  publishing: CollectionPublishing;
  seo?: CollectionSEO;
  productCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Blog Types
// ============================================

interface BlogSEO {
  pageTitle?: string;
  metaDescription?: string;
  ogImage?: string;
  canonicalUrl?: string;
  noIndex?: boolean;
}

export interface IBlogCategory {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  order: number;
  isActive: boolean;
  postCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type BlogPostStatus = "draft" | "scheduled" | "published" | "archived";
type BlogPostVisibility = "public" | "private" | "password";

interface BlogPostFeaturedImage {
  url?: string;
  alt?: string;
}

export interface IBlogPost {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  excerpt?: string;
  content: string;
  featuredImage?: BlogPostFeaturedImage;
  authorId: Types.ObjectId;
  authorName?: string;
  categoryIds: Types.ObjectId[];
  tags: string[];
  status: BlogPostStatus;
  visibility: BlogPostVisibility;
  password?: string;
  publishedAt?: Date;
  scheduledFor?: Date;
  allowComments: boolean;
  isFeatured: boolean;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  readingTime: number;
  seo?: BlogSEO;
  createdAt: Date;
  updatedAt: Date;
}

type BlogCommentStatus = "pending" | "approved" | "spam" | "trash";

export interface IBlogComment {
  _id: Types.ObjectId;
  postId: Types.ObjectId;
  parentId?: Types.ObjectId | null;
  userId?: Types.ObjectId;
  authorName: string;
  authorEmail: string;
  authorWebsite?: string;
  content: string;
  status: BlogCommentStatus;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Menu / Navigation Types
// ============================================

export type MenuLocation =
  | "header"
  | "header-mega"
  | "footer"
  | "mobile"
  | "sidebar"
  | "custom";

type MenuItemType =
  | "custom"
  | "page"
  | "product"
  | "category"
  | "collection"
  | "brand"
  | "blog"
  | "blog-post"
  | "external";

interface IMenuItem {
  _id?: Types.ObjectId | string;
  label: string;
  url: string;
  type: MenuItemType;
  target: "_self" | "_blank";
  icon?: string;
  image?: string;
  description?: string;
  badge?: string;
  badgeColor?: string;
  isFeatured?: boolean;
  isMegaColumn?: boolean;
  columnTitle?: string;
  children: IMenuItem[];
}

export interface IMenu {
  _id: Types.ObjectId;
  name: string;
  handle: string;
  location: MenuLocation;
  description?: string;
  items: IMenuItem[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
