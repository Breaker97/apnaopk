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
    // Optional since failed charges are recorded: a card declined at Stripe
    // never produced an order, because the order is written at capture. Every
    // SUCCEEDED row still carries both — they are written from an order — so
    // no reader of paid money sees a change.
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      index: true,
    },
    orderNumber: {
      type: String,
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
    /**
     * Why the gateway said no, in the gateway's own words.
     *
     * Kept raw and separate from `note`, which is a human's sentence. Nothing
     * shows these to a shopper: a store worker reads them to answer "my card
     * was refused, why?", and `card_declined` on a hundred rows in an hour is
     * how a card-testing run announces itself.
     *
     * `failureCode` is the gateway's code as it arrived; normalising it into a
     * shared vocabulary, and translating it for the shopper, belongs with the
     * checkout error work, not here.
     */
    failureCode: {
      type: String,
      trim: true,
      index: true,
    },
    /**
     * The gateway's own code, exactly as it arrived. `failureCode` above is
     * the normalized one everything counts by; this is what a store worker
     * quotes back to the gateway's support, and what says the normalizing
     * table needs another row.
     */
    gatewayCode: {
      type: String,
      trim: true,
    },
    gatewayMessage: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    /**
     * The cart this payment was attempted from, when the attempt never became
     * an order. It is the same token the abandoned-checkout record carries, so
     * a failed payment and the checkout it belongs to can be put side by side.
     * Indexed through `{ checkoutToken, createdAt }` below, which leads with it.
     */
    checkoutToken: {
      type: String,
      trim: true,
    },
    /**
     * The checkout attempt this charge belongs to. Set from the moment the
     * gateway is first asked, so the rows of a failed try are already tied to
     * something before any order exists; `orderId` joins them later, when one
     * of the tries finally succeeds.
     */
    checkoutAttemptId: {
      type: Schema.Types.ObjectId,
      ref: "CheckoutAttempt",
      index: true,
    },
    /** Who told us: a webhook, the shopper's return, or a reconcile sweep. */
    source: {
      type: String,
      trim: true,
    },
    clientIp: {
      type: String,
      trim: true,
    },
    /**
     * Who was trying to pay, on a row that has no order to name them.
     *
     * The card-testing counter needs something that follows a shopper across
     * carts — a fresh cart costs a script nothing, an email address costs it a
     * little more. Lower-cased so two spellings of one address are one
     * shopper.
     */
    customerEmail: {
      type: String,
      trim: true,
      lowercase: true,
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
// Failed charges are read two ways: everything that went wrong on one
// checkout, and everything one address has been trying. Both are new with
// failure logging, and both sort by time.
PaymentTransactionSchema.index({ checkoutToken: 1, createdAt: -1 });
PaymentTransactionSchema.index({ clientIp: 1, createdAt: -1 });
// The card-testing counter's own lookup: this shopper's recent refusals.
PaymentTransactionSchema.index({ customerEmail: 1, createdAt: -1 });
// Every gateway resends webhooks, and `recordChargeFailure` answers the second
// delivery by looking the event id up here. Unindexed, that was a scan of the
// whole collection per redelivered failure — on the one path that must stay
// cheap, because a gateway having a bad afternoon is exactly when it fires.
// Sparse: only a failure row carries the key, and most rows never will.
PaymentTransactionSchema.index({ "metadata.dedupeKey": 1 }, { sparse: true });

export const PaymentTransaction =
  models.PaymentTransaction ||
  model("PaymentTransaction", PaymentTransactionSchema);
