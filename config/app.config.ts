/**
 * Application Configuration
 * Central configuration for the Storify e-commerce platform
 */

import { DEFAULT_STORE_NAME } from "./branding.config";

export const appConfig = {
  // App Info
  name: DEFAULT_STORE_NAME,
  description: "Multi-vendor E-commerce Platform",
  version: "1.0.0",

  // Default vendor slug (used in single-vendor mode)
  // Multi-vendor mode is controlled via database: settings.multiVendorMode.enabled
  defaultVendorSlug: "main-store",

  // Commission Settings (for multi-vendor mode)
  defaultCommission: 10, // Percentage

  // Pagination
  defaultPageSize: 12,
  maxPageSize: 100,

  // Image Upload
  maxImageSize: 5 * 1024 * 1024, // 5MB
  allowedImageTypes: ["image/jpeg", "image/png", "image/webp"],
  maxProductImages: 10,

  // Cart
  cartExpiryDays: 30,
  maxCartItems: 50,

  // Order
  orderNumberPrefix: "ORD",

  // Currency
  currency: {
    code: "USD",
    symbol: "$",
    locale: "en-US",
  },

  // URLs
  urls: {
    home: "/",
    login: "/login",
    register: "/register",
    adminDashboard: "/admin/dashboard",
    vendorDashboard: "/vendor/dashboard",
    staffDashboard: "/staff/dashboard",
    customerOrders: "/account/orders",
  },
} as const;

// User Roles
export const USER_ROLES = {
  CUSTOMER: "customer",
  VENDOR: "vendor",
  ADMIN: "admin",
  STAFF: "staff",
  SELLER: "seller", // Legacy staff role retained for existing accounts
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

// User Account Statuses
export const USER_ACCOUNT_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  BANNED: "banned",
} as const;

export type UserAccountStatus =
  (typeof USER_ACCOUNT_STATUS)[keyof typeof USER_ACCOUNT_STATUS];

// Order Statuses
export const ORDER_STATUS = {
  PREORDERED: "preordered",
  PENDING: "pending",
  PROCESSING: "processing",
  SHIPPED: "shipped",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/**
 * Whose hands the cash lands in on a cash-on-delivery sale.
 *
 * The whole marketplace ledger turns on this. A vendor delivering with their
 * own van takes the notes and owes the platform its commission; a parcel that
 * went out on the platform's courier is collected by the platform, which then
 * owes the vendor their earnings. Those are opposite directions of payment,
 * and before this the code only knew the first one — so a platform-collected
 * COD sale billed the vendor commission on money they had never touched AND
 * withheld the earnings they were actually owed.
 *
 * `vendor` is the default everywhere, because it is what every existing order
 * already behaves as.
 */
export const COD_COLLECTED_BY = {
  VENDOR: "vendor",
  PLATFORM: "platform",
} as const;

export type CodCollectedBy =
  (typeof COD_COLLECTED_BY)[keyof typeof COD_COLLECTED_BY];

/** A vendor may defer to the store-wide setting rather than state their own. */
export const COD_COLLECTED_BY_INHERIT = "inherit" as const;

// Payment Statuses
export const PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  PARTIALLY_PAID: "partially_paid",
  REFUNDED: "refunded",
  PARTIALLY_REFUNDED: "partially_refunded",
} as const;

export type PaymentStatus =
  (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

// Product Statuses
export const PRODUCT_STATUS = {
  ACTIVE: "active",
  DRAFT: "draft",
  UNLISTED: "unlisted",
} as const;

export type ProductStatus =
  (typeof PRODUCT_STATUS)[keyof typeof PRODUCT_STATUS];

// Vendor Statuses
export const VENDOR_STATUS = {
  PENDING: "pending",
  PAYMENT_REQUIRED: "payment_required",
  APPROVED: "approved",
  REJECTED: "rejected",
  SUSPENDED: "suspended",
} as const;

export type VendorStatus = (typeof VENDOR_STATUS)[keyof typeof VENDOR_STATUS];

// Vendor application lifecycle before a Vendor record is approved.
export const VENDOR_APPLICATION_STATUS = {
  DRAFT: "draft",
  PAYMENT_PENDING: "payment_pending",
  PAID_PENDING_SUBMIT: "paid_pending_submit",
  SUBMITTED: "submitted",
  APPROVED: "approved",
  REJECTED: "rejected",
  REFUNDED: "refunded",
} as const;

export type VendorApplicationStatus =
  (typeof VENDOR_APPLICATION_STATUS)[keyof typeof VENDOR_APPLICATION_STATUS];

export const VENDOR_APPLICATION_PAYMENT_STATUS = {
  NOT_REQUIRED: "not_required",
  UNPAID: "unpaid",
  PENDING: "pending",
  PAID: "paid",
  FAILED: "failed",
  EXPIRED: "expired",
  REFUNDED: "refunded",
} as const;

export type VendorApplicationPaymentStatus =
  (typeof VENDOR_APPLICATION_PAYMENT_STATUS)[keyof typeof VENDOR_APPLICATION_PAYMENT_STATUS];

// Vendor subscription plan catalog status
export const VENDOR_PLAN_STATUS = {
  ACTIVE: "active",
  ARCHIVED: "archived",
} as const;

export type VendorPlanStatus =
  (typeof VENDOR_PLAN_STATUS)[keyof typeof VENDOR_PLAN_STATUS];

// Plan billing cadence. "none" = free / no recurring charge.
export const VENDOR_BILLING_INTERVAL = {
  MONTHLY: "monthly",
  YEARLY: "yearly",
  NONE: "none",
} as const;

export type VendorBillingInterval =
  (typeof VENDOR_BILLING_INTERVAL)[keyof typeof VENDOR_BILLING_INTERVAL];

// Per-vendor subscription lifecycle. Orthogonal to VENDOR_STATUS and role.
export const VENDOR_SUBSCRIPTION_STATUS = {
  INCOMPLETE: "incomplete",
  TRIALING: "trialing",
  ACTIVE: "active",
  PAST_DUE: "past_due",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
} as const;

export type VendorSubscriptionStatus =
  (typeof VENDOR_SUBSCRIPTION_STATUS)[keyof typeof VENDOR_SUBSCRIPTION_STATUS];

export const VENDOR_PENDING_CHANGE_TYPE = {
  UPGRADE: "upgrade",
  DOWNGRADE: "downgrade",
  CANCEL: "cancel",
} as const;

export type VendorPendingChangeType =
  (typeof VENDOR_PENDING_CHANGE_TYPE)[keyof typeof VENDOR_PENDING_CHANGE_TYPE];

export const VENDOR_PENDING_CHANGE_STATUS = {
  AWAITING_VENDOR: "awaiting_vendor",
  AWAITING_PAYMENT: "awaiting_payment",
  SCHEDULED: "scheduled",
  APPLIED: "applied",
  FAILED: "failed",
  EXPIRED: "expired",
} as const;

export type VendorPendingChangeStatus =
  (typeof VENDOR_PENDING_CHANGE_STATUS)[keyof typeof VENDOR_PENDING_CHANGE_STATUS];

// Subscription statuses that count as "occupying" a vendor's single active
// subscription slot (used by the partial-unique index and commission resolution).
export const ACTIVE_SUBSCRIPTION_STATUSES: VendorSubscriptionStatus[] = [
  VENDOR_SUBSCRIPTION_STATUS.TRIALING,
  VENDOR_SUBSCRIPTION_STATUS.ACTIVE,
  VENDOR_SUBSCRIPTION_STATUS.PAST_DUE,
];

// Dunning policy for a lapsed paid subscription. Gateway-agnostic: when a paid
// period ends without payment, the subscription enters PAST_DUE and is retried
// up to MAX_RETRIES over a grace window (staggered by backoff) before it finally
// EXPIRES and the plan benefit is revoked. Mirrors the WooCommerce Subscriptions
// model (retry, hold, then fail) without assuming a specific payment provider.
// The actual charge attempt is a seam a real billing engine plugs in later; the
// state machine here decides WHEN to retry and WHEN to give up.
export const SUBSCRIPTION_DUNNING = {
  /** How many charge retries before the subscription expires. */
  MAX_RETRIES: 5,
  /** Total grace window (days) from period-end to final expiry. */
  GRACE_PERIOD_DAYS: 7,
  /** Hours between successive retries (staggered backoff). Length need not
   *  equal MAX_RETRIES — the state machine clamps by GRACE_PERIOD_DAYS. */
  RETRY_BACKOFF_HOURS: [12, 12, 24, 48, 72],
} as const;

/**
 * How long after a Stripe takeover's due date the local clock keeps waiting
 * before it resumes ordinary dunning.
 *
 * A vendor switching from a pay-per-period gateway onto Stripe auto-renewal has
 * a Stripe subscription that first charges exactly when their bought period
 * runs out, so the boundary would otherwise read as an unpaid lapse. Stripe
 * settles within minutes; this is slack for delivery delays and card retries,
 * bounded so a takeover that never settles still lapses the store.
 */
export const STRIPE_TAKEOVER_SETTLE_WINDOW_MS = 48 * 60 * 60 * 1000;

export const VENDOR_PAYMENT_INVITATION = {
  DEADLINE_DAYS: 7,
  REMINDER_DAYS: [3, 6],
} as const;

export const VENDOR_SUBSCRIPTION_TERMS_VERSION = "vendor-subscription-v1";

// Ladder rung status. "archived" takes a rung off sale but keeps its number
// reserved, because days already sold on it still reference the number.
export const BOOST_POSITION_STATUS = {
  ACTIVE: "active",
  ARCHIVED: "archived",
} as const;

export type BoostPositionStatus =
  (typeof BOOST_POSITION_STATUS)[keyof typeof BOOST_POSITION_STATUS];

/** Highest rung number the ladder allows. */
export const BOOST_MAX_POSITIONS = 50;

// Boost campaign lifecycle. A campaign is one product boosted under one
// purchased package; at most one live (pending/active/paused) campaign may
// exist per product, enforced by a partial-unique index.
export const BOOST_CAMPAIGN_STATUS = {
  PENDING_PAYMENT: "pending_payment",
  /** Paid, but the booked range opens on a later day. */
  SCHEDULED: "scheduled",
  ACTIVE: "active",
  PAUSED: "paused",
  EXPIRED: "expired",
  CANCELED: "canceled",
} as const;

export type BoostCampaignStatus =
  (typeof BOOST_CAMPAIGN_STATUS)[keyof typeof BOOST_CAMPAIGN_STATUS];

export const BOOST_CANCEL_REASON = {
  ADMIN: "admin",
  /** The vendor withdrew a booking that had not started yet. */
  VENDOR: "vendor",
  CHECKOUT_EXPIRED: "checkout_expired",
  CHECKOUT_ABANDONED: "checkout_abandoned",
  PRODUCT_DELETED: "product_deleted",
  /** The product was unpublished or archived while it still held booked days. */
  PRODUCT_UNAVAILABLE: "product_unavailable",
  /** The vendor's store went dark — suspended, deactivated, or lapsed. */
  VENDOR_INACTIVE: "vendor_inactive",
  PAYMENT_REVERSED: "payment_reversed",
  /** The reservation lapsed before payment landed. */
  HOLD_EXPIRED: "hold_expired",
  /** Paid, but the booked days were gone by the time fulfilment ran. */
  SLOT_RESOLD: "slot_resold",
  /** Paid, but the terms or the window no longer held at fulfilment. */
  FULFILMENT_REFUSED: "fulfilment_refused",
} as const;

export type BoostCancelReason =
  (typeof BOOST_CANCEL_REASON)[keyof typeof BOOST_CANCEL_REASON];

// How long an unpaid checkout holds its booked days. The floor is 35, not 30:
// Stripe requires checkout.session.expires_at to be at least 30 minutes after
// session creation, and the hold is stamped before the session is created, so
// a flat 30 lands inside the floor and every Stripe boost checkout would fail.
export const BOOST_HOLD_MIN_MINUTES = 35;
export const BOOST_HOLD_MAX_MINUTES = 120;

// Grace given to an in-flight grant before the hold sweep treats a paid-but-
// still-pending campaign as unfulfillable. Without it the sweep would race a
// webhook that is about to succeed.
export const BOOST_FULFILMENT_SETTLE_MS = 10 * 60 * 1000;

// How many unpaid checkouts one vendor may hold at once. There is no separate
// "reserve" endpoint by design — that would be a way to hold premium inventory
// with no payment intent behind it — and this is the ceiling that backs it up.
export const BOOST_MAX_OPEN_HOLDS = 3;

// Storefront surfaces a sponsored product can appear on. Also the metric
// bucket dimension for impression/click tracking.
export const BOOST_PLACEMENT = {
  HOME: "home",
  LISTING: "listing",
  PRODUCT_PAGE: "pdp",
} as const;

export type BoostPlacement =
  (typeof BOOST_PLACEMENT)[keyof typeof BOOST_PLACEMENT];

// Vendor→platform payments (boost purchases, subscription periods). "manual"
// is an admin-recorded offline payment; the rest map 1:1 onto the storefront
// payment gateways. COD is deliberately absent — nothing is delivered.
export const PLATFORM_PAYMENT_PROVIDER = {
  STRIPE: "stripe",
  PAYPAL: "paypal",
  RAZORPAY: "razorpay",
  PAYSTACK: "paystack",
  PESAPAL: "pesapal",
  IOTEC: "iotec",
  ORANGE_MONEY: "orange_money",
  MTN_MOMO: "mtn_momo",
  MANUAL: "manual",
} as const;

export type PlatformPaymentProvider =
  (typeof PLATFORM_PAYMENT_PROVIDER)[keyof typeof PLATFORM_PAYMENT_PROVIDER];

// Gateway providers selectable by vendors (excludes "manual").
export const PLATFORM_PAYMENT_GATEWAYS = [
  PLATFORM_PAYMENT_PROVIDER.STRIPE,
  PLATFORM_PAYMENT_PROVIDER.PAYPAL,
  PLATFORM_PAYMENT_PROVIDER.RAZORPAY,
  PLATFORM_PAYMENT_PROVIDER.PAYSTACK,
  PLATFORM_PAYMENT_PROVIDER.PESAPAL,
  PLATFORM_PAYMENT_PROVIDER.IOTEC,
  PLATFORM_PAYMENT_PROVIDER.ORANGE_MONEY,
  PLATFORM_PAYMENT_PROVIDER.MTN_MOMO,
] as const;

export type PlatformPaymentGateway =
  (typeof PLATFORM_PAYMENT_GATEWAYS)[number];

export const PLATFORM_PAYMENT_KIND = {
  BOOST: "boost",
  SUBSCRIPTION: "subscription",
  /**
   * Commission the platform is owed on sales the merchant collected themselves
   * — cash at the counter, COD, a card on their own terminal.
   *
   * The other two kinds buy the vendor something. This one settles a debt that
   * already exists: the money never reached the platform, so there is no payout
   * to deduct the commission from, and without a rail in this direction it was
   * simply never collected. See `lib/payment-custody.ts`.
   */
  COMMISSION: "commission",
} as const;

export type PlatformPaymentKind =
  (typeof PLATFORM_PAYMENT_KIND)[keyof typeof PLATFORM_PAYMENT_KIND];

export const PLATFORM_PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  FAILED: "failed",
  EXPIRED: "expired",
  REFUNDED: "refunded",
} as const;

export type PlatformPaymentStatus =
  (typeof PLATFORM_PAYMENT_STATUS)[keyof typeof PLATFORM_PAYMENT_STATUS];
