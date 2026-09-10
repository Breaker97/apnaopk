import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

const PAYMENT_TRANSACTION_TYPES = [
  "charge",
  "refund",
  "adjustment",
] as const;

const PAYMENT_TRANSACTION_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "cancelled",
] as const;

/**
 * One consignment's slice of a refund, split the way the sale was.
 *
 * A refund row used to carry only `grossAmount`, so the ledger and the payout
 * engine each had to re-derive what that number was made of — and both did it
 * by prorating across the whole order, which is right only when the refund is
 * genuinely "X% of everything". A return never is. Recording the split at the
 * moment the money moves makes it a fact rather than an inference, and one
 * both engines can read.
 *
 * Absent on order-level refunds, which have no item context to split by, and
 * on every refund written before this existed. Those still prorate.
 */
const RefundAllocationSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    /** Goods, before the platform's commission is separated out of them. */
    merchandise: { type: Number, required: true, min: 0, default: 0 },
    shipping: { type: Number, required: true, min: 0, default: 0 },
    tax: { type: Number, required: true, min: 0, default: 0 },
    duty: { type: Number, required: true, min: 0, default: 0 },
    // The refund administration fee, when the store charges one: commission
    // the platform kept rather than handed back. Optional and undefaulted, so
    // a store with no fee writes exactly the record it wrote before the fee
    // existed and both money engines read it as "the whole cut comes back".
    commissionRetained: { type: Number, min: 0 },
  },
  { _id: false },
);

const PaymentTransactionSchema = new Schema(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    orderNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
    },
    payoutId: {
      type: Schema.Types.ObjectId,
      ref: "Payout",
      index: true,
    },
    type: {
      type: String,
      enum: PAYMENT_TRANSACTION_TYPES,
      required: true,
    },
    status: {
      type: String,
      enum: PAYMENT_TRANSACTION_STATUSES,
      required: true,
      default: "succeeded",
    },
    provider: {
      type: String,
      trim: true,
      lowercase: true,
      default: "manual",
    },
    paymentMethod: {
      type: String,
      trim: true,
      lowercase: true,
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: "USD",
    },
    grossAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    feeAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    netAmount: {
      type: Number,
      required: true,
    },
    refundedAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    // `undefined` rather than `[]` by default, so "this refund never recorded
    // an allocation" stays distinguishable from "it recorded an empty one".
    // The posting rules read that difference to decide whether to prorate.
    refundAllocation: {
      type: [RefundAllocationSchema],
      default: undefined,
    },
    externalId: {
      type: String,
      trim: true,
      index: true,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    createdBy: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

PaymentTransactionSchema.index({ createdAt: -1 });
PaymentTransactionSchema.index({ type: 1, status: 1, createdAt: -1 });
PaymentTransactionSchema.index({ vendorId: 1, createdAt: -1 });
// The admin transactions list can filter by status-only or provider-only and
// always sorts by createdAt. The { type, status, createdAt } compound above only
// helps when type is also present, so these two carry the single-facet lists and
// replace the former field-level index:true on `status` and `provider`.
PaymentTransactionSchema.index({ status: 1, createdAt: -1 });
PaymentTransactionSchema.index({ provider: 1, createdAt: -1 });

export const PaymentTransaction =
  models.PaymentTransaction ||
  model("PaymentTransaction", PaymentTransactionSchema);
