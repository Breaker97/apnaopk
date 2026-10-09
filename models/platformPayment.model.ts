/**
 * PlatformPayment Model
 * One row per vendor→platform payment attempt (boost purchases and
 * subscription periods). This is the multi-gateway dispatch record: every
 * gateway completion route (webhook/IPN/callback/verify) looks attempts up by
 * our merchant `reference` or the gateway's own id, then finalizes by `kind`.
 *
 * Idempotency: non-Stripe gateways have no webhook-event lease, so the
 * guarded mark-paid update — findOneAndUpdate({_id, status: {$ne: "paid"}})
 * — is the single defense against replayed webhooks/verify races. Mirrors
 * the guarded-update convention of the order finalizers.
 */

import mongoose, { Schema, Document, Model, Types } from "mongoose";
import {
  PLATFORM_PAYMENT_KIND,
  PLATFORM_PAYMENT_PROVIDER,
  PLATFORM_PAYMENT_STATUS,
  type PlatformPaymentKind,
  type PlatformPaymentProvider,
  type PlatformPaymentStatus,
} from "@/config/app.config";

/** Merchant-reference prefixes, dispatchable where gateways round-trip our
 * reference (Paystack reference, Pesapal merchant ref, ioTec externalId). */
export const PLATFORM_PAYMENT_REFERENCE_PREFIX: Record<
  PlatformPaymentKind,
  string
> = {
  [PLATFORM_PAYMENT_KIND.BOOST]: "BOOST-",
  [PLATFORM_PAYMENT_KIND.SUBSCRIPTION]: "VSUB-",
  [PLATFORM_PAYMENT_KIND.COMMISSION]: "VCOM-",
};

export function isPlatformPaymentReference(reference: unknown): boolean {
  return (
    typeof reference === "string" &&
    Object.values(PLATFORM_PAYMENT_REFERENCE_PREFIX).some((prefix) =>
      reference.startsWith(prefix),
    )
  );
}

/**
 * The booking terms this attempt was created for, frozen at attempt time.
 *
 * Amount alone cannot identify a boost booking — Position 1 x 7 days and
 * Position 5 x 35 days can price identically — so a stale gateway reference
 * from an abandoned attempt could otherwise pay for terms the campaign no
 * longer has. Fulfilment compares these before it grants anything.
 */
interface IBoostPaymentTerms {
  position: number;
  startDay: string;
  endDay: string;
}

export interface IPlatformPayment extends Document {
  kind: PlatformPaymentKind;
  /** kind "boost" */
  campaignId: Types.ObjectId | null;
  /** kind "boost" — frozen booking terms, checked before fulfilment. */
  boostTerms: IBoostPaymentTerms | null;
  /** kind "subscription" */
  subscriptionId: Types.ObjectId | null;
  applicationId: Types.ObjectId | null;
  planId: Types.ObjectId | null;
  /** The subscription period being purchased (set at finalize for renewals
   * that extend from the previous period end). */
  periodStart: Date | null;
  periodEnd: Date | null;
  /**
   * kind "commission" — the debt this attempt is paying.
   *
   * The claim on the underlying sales lives on `CommissionInvoice`, not here,
   * for the same reason a boost attempt points at a campaign: a vendor who
   * abandons one checkout and completes another leaves two attempts behind,
   * and what is owed must not move because of that.
   */
  commissionInvoiceId: Types.ObjectId | null;
  vendorId: Types.ObjectId;
  userId: string;
  provider: PlatformPaymentProvider;
  status: PlatformPaymentStatus;
  amount: number;
  /**
   * What has been given back, CUMULATIVE — never one refund's own figure.
   *
   * Stripe reports `amount_refunded` as a running total that arrives replayed,
   * out of order and concurrently, and the boost credit formula subtracts this
   * from what is owed. A per-refund figure could not be reconciled against
   * either.
   *
   * It was written before it was declared here, which with `strict` on meant
   * mongoose stripped every `$set` of it: the field never reached the database,
   * `{$lt}` never matched the document that lacked it, and so a partially
   * refunded boost went on showing the whole refund as still owed while the
   * money had already left.
   */
  refundedAmount: number;
  refundedAt?: Date;
  ledgerRefundAcceptedAmount?: number;
  currency: string;
  /** Our merchant reference ("BOOST-<id>-<ts36>" / "VSUB-<id>-<ts36>"). */
  reference: string;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  paystackTransactionId: string | null;
  pesapalOrderTrackingId: string | null;
  iotecTransactionId: string | null;
  // Orange mints the pay/notif tokens only in its web-payment response, so an
  // attempt carries them from initiation until the notification is verified.
  orangeMoneyPayToken: string | null;
  orangeMoneyNotifToken: string | null;
  orangeMoneyTxnId: string | null;
  // The X-Reference-Id UUID we minted for requesttopay — MTN returns no id of
  // its own, so this is the only key its status can ever be read by. Stored
  // BEFORE the gateway call (initiation is two-phase like ioTec's).
  mtnMomoReferenceId: string | null;
  /** MTN's financialTransactionId, present once SUCCESSFUL. */
  mtnMomoTransactionId: string | null;
  paidAt: Date | null;
  benefitReversedAt?: Date;
  benefitGrantedAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  /**
   * Provider "manual" only: what the admin wrote down when recording money
   * taken offline — a bank transfer id, a receipt number.
   */
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const PlatformPaymentSchema = new Schema<IPlatformPayment>(
  {
    kind: {
      type: String,
      enum: Object.values(PLATFORM_PAYMENT_KIND),
      required: true,
    },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: "BoostCampaign",
      default: null,
    },
    boostTerms: {
      type: new Schema<IBoostPaymentTerms>(
        {
          position: { type: Number, required: true, min: 1 },
          startDay: { type: String, required: true },
          endDay: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: "VendorSubscription",
      default: null,
    },
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: "VendorApplication",
      default: null,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: "VendorPlan",
      default: null,
    },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    commissionInvoiceId: {
      type: Schema.Types.ObjectId,
      ref: "CommissionInvoice",
      default: null,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    userId: {
      type: String,
      required: true,
    },
    provider: {
      type: String,
      enum: Object.values(PLATFORM_PAYMENT_PROVIDER),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(PLATFORM_PAYMENT_STATUS),
      default: PLATFORM_PAYMENT_STATUS.PENDING,
    },
    amount: {
      type: Number,
      required: true,
      min: [0, "Amount cannot be negative"],
    },
    // Undefaulted on purpose: a row written before this existed carries
    // nothing, and the claims that move it have to treat "missing" and "zero"
    // alike anyway — see `refundedAtMostMatch`.
    refundedAmount: {
      type: Number,
      min: [0, "A refund cannot be negative"],
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    reference: {
      type: String,
      required: true,
    },
    stripeCheckoutSessionId: { type: String, default: null },
    stripePaymentIntentId: { type: String, default: null },
    paypalOrderId: { type: String, default: null },
    paypalCaptureId: { type: String, default: null },
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    paystackTransactionId: { type: String, default: null },
    pesapalOrderTrackingId: { type: String, default: null },
    iotecTransactionId: { type: String, default: null },
    orangeMoneyPayToken: { type: String, default: null },
    orangeMoneyNotifToken: { type: String, default: null },
    orangeMoneyTxnId: { type: String, default: null },
    mtnMomoReferenceId: { type: String, default: null },
    mtnMomoTransactionId: { type: String, default: null },
    paidAt: { type: Date, default: null },
    ledgerRefundAcceptedAmount: { type: Number, min: 0 },
    refundedAt: { type: Date },
  // Set once the purchased benefit (boost activation / period advance) has
  // landed. status PAID with this null = crashed mid-grant; retries repair.
  benefitGrantedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    note: { type: String, default: null, trim: true, maxlength: 200 },
  },
  {
    timestamps: true,
  },
);

PlatformPaymentSchema.index({ kind: 1, campaignId: 1, createdAt: -1 });
PlatformPaymentSchema.index({ kind: 1, subscriptionId: 1, createdAt: -1 });
PlatformPaymentSchema.index({ kind: 1, applicationId: 1, createdAt: -1 });
PlatformPaymentSchema.index({ kind: 1, commissionInvoiceId: 1, createdAt: -1 });
// The MTN MoMo / Orange Money reconciliation crons sweep pending attempts by
// provider inside a time window; without this they scan the collection.
PlatformPaymentSchema.index({ provider: 1, status: 1, createdAt: -1 });

// Each dispatch key is unique among the documents that carry it. Completion
// routes resolve attempts by exactly one of these, so a duplicate would make
// payment attribution ambiguous.
const uniqueWhenString = (field: string) => ({
  unique: true,
  partialFilterExpression: { [field]: { $type: "string" } },
});
PlatformPaymentSchema.index({ reference: 1 }, uniqueWhenString("reference"));
PlatformPaymentSchema.index(
  { stripeCheckoutSessionId: 1 },
  uniqueWhenString("stripeCheckoutSessionId"),
);
PlatformPaymentSchema.index(
  { paypalOrderId: 1 },
  uniqueWhenString("paypalOrderId"),
);
PlatformPaymentSchema.index(
  { razorpayOrderId: 1 },
  uniqueWhenString("razorpayOrderId"),
);
PlatformPaymentSchema.index(
  { pesapalOrderTrackingId: 1 },
  uniqueWhenString("pesapalOrderTrackingId"),
);
PlatformPaymentSchema.index(
  { iotecTransactionId: 1 },
  uniqueWhenString("iotecTransactionId"),
);
PlatformPaymentSchema.index(
  { orangeMoneyTxnId: 1 },
  uniqueWhenString("orangeMoneyTxnId"),
);
PlatformPaymentSchema.index(
  { mtnMomoReferenceId: 1 },
  uniqueWhenString("mtnMomoReferenceId"),
);
PlatformPaymentSchema.index(
  { mtnMomoTransactionId: 1 },
  uniqueWhenString("mtnMomoTransactionId"),
);
// Stripe `charge.refunded` resolves the attempt by payment-intent id — the one
// dispatch key that had no index behind it.
PlatformPaymentSchema.index(
  { stripePaymentIntentId: 1 },
  uniqueWhenString("stripePaymentIntentId"),
);

/**
 * "This attempt has given back less than `total`" — the guard a refund claims
 * its increase under.
 *
 * Spelled out here rather than written at each call site because the obvious
 * spelling is wrong in a way nothing reports. MongoDB brackets `$lt` by type,
 * so `{refundedAmount: {$lt: 10}}` does NOT match a document that has no
 * `refundedAmount` at all — which is every row written before the field
 * existed, and so every FIRST refund. The claim silently matched nothing, the
 * cumulative total never moved off zero, and the credit formula went on
 * offering a refund that had already been paid.
 */
export function refundedBelowMatch(total: number): Record<string, unknown> {
  return {
    $or: [
      { refundedAmount: { $lt: total } },
      { refundedAmount: { $exists: false } },
      { refundedAmount: null },
    ],
  };
}

export const PlatformPayment: Model<IPlatformPayment> =
  mongoose.models.PlatformPayment ||
  mongoose.model<IPlatformPayment>("PlatformPayment", PlatformPaymentSchema);
