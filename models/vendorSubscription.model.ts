/**
 * VendorSubscription Model
 * Per-vendor billing state — the source of truth for which plan a vendor is on
 * and its lifecycle. The effective commission is snapshotted here at subscribe
 * time and also projected onto Vendor.commission (the enforcement cache read by
 * the order/payout path). Status is orthogonal to VENDOR_STATUS and to the
 * user's role.
 */

import mongoose, { Schema, Document, Model } from "mongoose";
import {
  VENDOR_SUBSCRIPTION_STATUS,
  VENDOR_BILLING_INTERVAL,
  ACTIVE_SUBSCRIPTION_STATUSES,
  VENDOR_PENDING_CHANGE_STATUS,
  VENDOR_PENDING_CHANGE_TYPE,
  type VendorSubscriptionStatus,
  type VendorBillingInterval,
  type VendorPendingChangeStatus,
  type VendorPendingChangeType,
} from "@/config/app.config";

interface IVendorSubscriptionPlanSnapshot {
  name: string;
  price: number;
  billingInterval: VendorBillingInterval;
  currency?: string;
  features?: string[];
  limits?: { products?: number | null; staff?: number | null };
  capabilities?: { aiAuthoring?: boolean };
  stripePriceId?: string | null;
}

export interface IVendorSubscription extends Document {
  vendorId: mongoose.Types.ObjectId;
  applicationId?: mongoose.Types.ObjectId | null;
  planId: mongoose.Types.ObjectId;
  status: VendorSubscriptionStatus;
  trialStart?: Date | null;
  trialEnd?: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  commissionRateSnapshot: number;
  planSnapshot: IVendorSubscriptionPlanSnapshot;
  activationMode: "auto" | "manual";
  cancelAtPeriodEnd: boolean;
  /** Billing provider. "stripe" = native auto-recurring (webhook-synced);
   * every other gateway is one-shot pay-per-period with a locally-advanced
   * clock (recordOneShotSubscriptionPayment); "manual" = free plans and
   * admin-comped rows. Paid onboarding rows begin incomplete and receive
   * their provider when the first payment lands. */
  provider:
    | "manual"
    | "stripe"
    | "paypal"
    | "razorpay"
    | "paystack"
    | "pesapal"
    | "iotec"
    | "orange_money"
    | "mtn_momo";
  paymentProviderRef: string | null;
  stripeCustomerId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripeSubscriptionItemId?: string | null;
  stripePriceId?: string | null;
  stripeLatestInvoiceId?: string | null;
  providerStatus?: string | null;
  providerStateUpdatedAt?: Date | null;
  lastPaymentAt: Date | null;
  firstPaymentFailedAt?: Date | null;
  failedInvoiceId?: string | null;
  pendingPlanId?: mongoose.Types.ObjectId | null;
  pendingPlanSnapshot?: IVendorSubscriptionPlanSnapshot | null;
  pendingCommissionRateSnapshot?: number | null;
  pendingChangeType?: VendorPendingChangeType | null;
  pendingChangeStatus?: VendorPendingChangeStatus | null;
  pendingChangeEffectiveAt?: Date | null;
  pendingStripeInvoiceId?: string | null;
  stripeScheduleId?: string | null;
  /**
   * A Stripe subscription waiting to take over billing from the one-shot rail.
   *
   * A vendor moving from Pesapal (or any pay-per-period gateway) onto Stripe's
   * auto-renewal has already paid through `currentPeriodEnd`, so the Stripe
   * subscription is created with a trial to that date and must not charge
   * before it. Until Stripe's first real invoice is paid, `provider` stays on
   * the old gateway: that is what keeps this row invisible to every Stripe path
   * (the sync's context lookups, the reconciliation query and the webhook
   * processors all scope themselves to `provider: "stripe"`), so the trialing
   * subscription's own webhooks cannot be mistaken for missing payment evidence
   * and revoke a vendor who is fully paid up.
   *
   * These three fields are the whole record of that pending handover.
   */
  stripeTakeoverSubscriptionId?: string | null;
  stripeTakeoverSessionId?: string | null;
  stripeTakeoverAt?: Date | null;
  lastReconciledAt?: Date | null;
  lastReconcileError?: string | null;
  notificationKeys: string[];
  /** Dunning state for a lapsed paid subscription. Zero/null until the period
   * ends unpaid, at which point the row goes PAST_DUE and the state machine in
   * getEffectiveSubscription drives retries: `retryCount` counts attempts,
   * `nextRetryAt` is when the next attempt is due, and `gracePeriodEnd` is the
   * hard deadline after which the subscription EXPIRES. */
  retryCount: number;
  nextRetryAt: Date | null;
  lastRetryAt: Date | null;
  gracePeriodEnd: Date | null;
  /** Derived from `status`: true while the row occupies the vendor's single
   * active-subscription slot. Backs a portable equality partial-unique index. */
  occupiesActiveSlot: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

function buildPlanSnapshotSchema() {
  return new Schema<IVendorSubscriptionPlanSnapshot>(
    {
      name: { type: String, default: "" },
      price: { type: Number, default: 0 },
      billingInterval: {
        type: String,
        enum: Object.values(VENDOR_BILLING_INTERVAL),
        default: VENDOR_BILLING_INTERVAL.NONE,
      },
      currency: { type: String, default: "USD", uppercase: true },
      features: { type: [String], default: [] },
      limits: {
        type: new Schema(
          {
            products: { type: Number, default: null },
            staff: { type: Number, default: null },
          },
          { _id: false },
        ),
        default: () => ({}),
      },
      capabilities: {
        type: new Schema(
          { aiAuthoring: { type: Boolean, default: false } },
          { _id: false },
        ),
        default: () => ({}),
      },
      stripePriceId: { type: String, default: null },
    },
    { _id: false },
  );
}

const VendorSubscriptionSchema = new Schema<IVendorSubscription>(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: "VendorApplication",
      default: null,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: "VendorPlan",
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(VENDOR_SUBSCRIPTION_STATUS),
      required: true,
      default: VENDOR_SUBSCRIPTION_STATUS.ACTIVE,
    },
    trialStart: { type: Date, default: null },
    trialEnd: { type: Date, default: null },
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    commissionRateSnapshot: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    planSnapshot: {
      type: buildPlanSnapshotSchema(),
      default: () => ({}),
    },
    activationMode: {
      type: String,
      enum: ["auto", "manual"],
      default: "auto",
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    provider: {
      type: String,
      enum: [
        "manual",
        "stripe",
        "paypal",
        "razorpay",
        "paystack",
        "pesapal",
        "iotec",
        "orange_money",
        "mtn_momo",
      ],
      default: "manual",
    },
    paymentProviderRef: {
      type: String,
      default: null,
    },
    stripeCustomerId: {
      type: String,
      default: null,
    },
    stripeCheckoutSessionId: {
      type: String,
      default: null,
    },
    stripeSubscriptionItemId: {
      type: String,
      default: null,
    },
    stripePriceId: {
      type: String,
      default: null,
    },
    stripeLatestInvoiceId: {
      type: String,
      default: null,
    },
    providerStatus: {
      type: String,
      default: null,
    },
    providerStateUpdatedAt: {
      type: Date,
      default: null,
    },
    lastPaymentAt: {
      type: Date,
      default: null,
    },
    firstPaymentFailedAt: {
      type: Date,
      default: null,
    },
    failedInvoiceId: {
      type: String,
      default: null,
    },
    pendingPlanId: {
      type: Schema.Types.ObjectId,
      ref: "VendorPlan",
      default: null,
    },
    pendingPlanSnapshot: {
      type: buildPlanSnapshotSchema(),
      default: null,
    },
    pendingCommissionRateSnapshot: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    pendingChangeType: {
      type: String,
      enum: [...Object.values(VENDOR_PENDING_CHANGE_TYPE), null],
      default: null,
    },
    pendingChangeStatus: {
      type: String,
      enum: [...Object.values(VENDOR_PENDING_CHANGE_STATUS), null],
      default: null,
    },
    pendingChangeEffectiveAt: {
      type: Date,
      default: null,
    },
    pendingStripeInvoiceId: {
      type: String,
      default: null,
    },
    stripeScheduleId: {
      type: String,
      default: null,
    },
    stripeTakeoverSubscriptionId: {
      type: String,
      default: null,
    },
    stripeTakeoverSessionId: {
      type: String,
      default: null,
    },
    stripeTakeoverAt: {
      type: Date,
      default: null,
    },
    lastReconciledAt: {
      type: Date,
      default: null,
    },
    lastReconcileError: {
      type: String,
      default: null,
      maxlength: 2000,
    },
    notificationKeys: {
      type: [String],
      default: [],
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    nextRetryAt: {
      type: Date,
      default: null,
    },
    lastRetryAt: {
      type: Date,
      default: null,
    },
    gracePeriodEnd: {
      type: Date,
      default: null,
    },
    occupiesActiveSlot: {
      type: Boolean,
      default: true,
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

// Keep the derived slot flag in sync with status for document saves/creates.
// Update paths (findByIdAndUpdate/updateOne) must set it explicitly alongside
// any status change — see setSubscriptionSlotFlag().
VendorSubscriptionSchema.pre("save", function () {
  this.occupiesActiveSlot = (
    ACTIVE_SUBSCRIPTION_STATUSES as VendorSubscriptionStatus[]
  ).includes(this.status);
});

// A vendor may hold at most ONE subscription in an "occupying" status
// (trialing/active/past_due). Cancelled/expired rows set occupiesActiveSlot
// false and are excluded from the unique index. The equality partial filter is
// portable to MongoDB 3.2+ (a `status: { $in: [...] }` filter would require 6.0+).
VendorSubscriptionSchema.index(
  { vendorId: 1 },
  {
    unique: true,
    partialFilterExpression: { occupiesActiveSlot: true },
  },
);

/** Helper for update paths: the slot flag value implied by a status. */
export function subscriptionOccupiesSlot(status: string): boolean {
  return (ACTIVE_SUBSCRIPTION_STATUSES as string[]).includes(status);
}
VendorSubscriptionSchema.index({ planId: 1 });
VendorSubscriptionSchema.index({ applicationId: 1 });
VendorSubscriptionSchema.index({ provider: 1, paymentProviderRef: 1 });
VendorSubscriptionSchema.index({ provider: 1, stripeLatestInvoiceId: 1 });
VendorSubscriptionSchema.index({ status: 1, trialEnd: 1 });
VendorSubscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });
VendorSubscriptionSchema.index({ pendingChangeStatus: 1, pendingChangeEffectiveAt: 1 });
VendorSubscriptionSchema.index({ lastReconcileError: 1, updatedAt: 1 });
// Pending Stripe takeovers: resolved by the paying subscription's id from the
// invoice webhook, and swept by due date when that webhook never arrives.
// Sparse because only a handful of rows are ever mid-handover.
VendorSubscriptionSchema.index(
  { stripeTakeoverSubscriptionId: 1 },
  { sparse: true },
);
VendorSubscriptionSchema.index({ stripeTakeoverAt: 1 }, { sparse: true });

// Next.js dev hot reload keeps Mongoose's global model cache alive. Recompile
// this model in development so newly-added fields and enum values are not
// validated against a stale schema until the server is restarted.
if (
  process.env.NODE_ENV === "development" &&
  mongoose.models.VendorSubscription
) {
  mongoose.deleteModel("VendorSubscription");
}

export const VendorSubscription: Model<IVendorSubscription> =
  mongoose.models.VendorSubscription ||
  mongoose.model<IVendorSubscription>(
    "VendorSubscription",
    VendorSubscriptionSchema,
  );
