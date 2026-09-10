import mongoose, { Schema, type Document, type Model } from "mongoose";

const VENDOR_SUBSCRIPTION_PAYMENT_STATUS = {
  OPEN: "open",
  PAID: "paid",
  FAILED: "failed",
  VOID: "void",
  REFUNDED: "refunded",
} as const;

type VendorSubscriptionPaymentStatus =
  (typeof VENDOR_SUBSCRIPTION_PAYMENT_STATUS)[keyof typeof VENDOR_SUBSCRIPTION_PAYMENT_STATUS];

/**
 * "stripe" rows mirror Stripe invoices (unique on provider+providerInvoiceId,
 * upserted by the billing sync). Every other provider is a one-shot
 * pay-per-period charge recorded by recordOneShotSubscriptionPayment:
 * providerInvoiceId is the gateway's transaction id (or a locally-minted
 * vsub_<subscriptionId>_<periodStartEpoch> when none exists) and
 * providerSubscriptionId is the local subscription id — one row per paid
 * period either way.
 */
export type VendorSubscriptionPaymentProvider =
  | "stripe"
  | "paypal"
  | "razorpay"
  | "paystack"
  | "pesapal"
  | "iotec"
  | "orange_money"
  | "mtn_momo"
  | "manual";

interface IVendorSubscriptionPayment extends Document {
  vendorId: mongoose.Types.ObjectId;
  subscriptionId: mongoose.Types.ObjectId;
  applicationId?: mongoose.Types.ObjectId | null;
  provider: VendorSubscriptionPaymentProvider;
  providerSubscriptionId: string;
  providerInvoiceId: string;
  providerPaymentIntentId?: string | null;
  status: VendorSubscriptionPaymentStatus;
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
  currency: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  attemptCount: number;
  paidAt?: Date | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  providerCreatedAt?: Date | null;
  providerStateUpdatedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const VendorSubscriptionPaymentSchema =
  new Schema<IVendorSubscriptionPayment>(
    {
      vendorId: {
        type: Schema.Types.ObjectId,
        ref: "Vendor",
        required: true,
      },
      subscriptionId: {
        type: Schema.Types.ObjectId,
        ref: "VendorSubscription",
        required: true,
      },
      applicationId: {
        type: Schema.Types.ObjectId,
        ref: "VendorApplication",
        default: null,
      },
      provider: {
        type: String,
        enum: [
          "stripe",
          "paypal",
          "razorpay",
          "paystack",
          "pesapal",
          "iotec",
          "orange_money",
          "mtn_momo",
          "manual",
        ],
        required: true,
      },
      providerSubscriptionId: {
        type: String,
        required: true,
      },
      providerInvoiceId: {
        type: String,
        required: true,
      },
      providerPaymentIntentId: {
        type: String,
        default: null,
      },
      status: {
        type: String,
        enum: Object.values(VENDOR_SUBSCRIPTION_PAYMENT_STATUS),
        required: true,
      },
      // Stripe's smallest currency unit, stored verbatim so these rows keep
      // matching what the provider reports (100000 = $1,000.00 in USD; UGX and
      // other zero-decimal currencies are already whole units). Order money is
      // stored in MAJOR units — never add the two without passing these through
      // `fromStripeAmount()` from `lib/stripe.ts` first.
      amountDue: { type: Number, default: 0, min: 0 },
      amountPaid: { type: Number, default: 0, min: 0 },
      amountRefunded: { type: Number, default: 0, min: 0 },
      currency: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
      },
      periodStart: { type: Date, default: null },
      periodEnd: { type: Date, default: null },
      attemptCount: { type: Number, default: 0, min: 0 },
      paidAt: { type: Date, default: null },
      failureCode: { type: String, default: null, maxlength: 500 },
      failureMessage: { type: String, default: null, maxlength: 2000 },
      providerCreatedAt: { type: Date, default: null },
      providerStateUpdatedAt: { type: Date, default: null },
    },
    { timestamps: true },
  );

VendorSubscriptionPaymentSchema.index(
  { provider: 1, providerInvoiceId: 1 },
  { unique: true },
);
VendorSubscriptionPaymentSchema.index({ vendorId: 1, createdAt: -1 });
VendorSubscriptionPaymentSchema.index({
  providerSubscriptionId: 1,
  providerCreatedAt: -1,
});
VendorSubscriptionPaymentSchema.index({ subscriptionId: 1, periodEnd: -1 });

if (
  process.env.NODE_ENV === "development" &&
  mongoose.models.VendorSubscriptionPayment
) {
  mongoose.deleteModel("VendorSubscriptionPayment");
}

export const VendorSubscriptionPayment: Model<IVendorSubscriptionPayment> =
  mongoose.models.VendorSubscriptionPayment ||
  mongoose.model<IVendorSubscriptionPayment>(
    "VendorSubscriptionPayment",
    VendorSubscriptionPaymentSchema,
  );
