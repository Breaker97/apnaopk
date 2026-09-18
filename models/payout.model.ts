import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

const PAYOUT_STATUSES = [
  "pending",
  "processing",
  "paid",
  "failed",
  "cancelled",
] as const;

const PayoutSchema = new Schema(
  {
    payoutNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
      index: true,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      default: "USD",
    },
    orderIds: {
      type: [Schema.Types.ObjectId],
      ref: "Order",
      default: [],
    },
    grossSales: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    /**
     * Delivery charges the vendor earned on these sales — parcels they paid to
     * deliver — already inside `netAmount`. Absent on payouts made before the
     * store handed delivery charges on, when it kept all of them.
     */
    shippingAmount: {
      type: Number,
      min: 0,
    },
    netAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    adjustments: {
      type: Number,
      default: 0,
    },
    /**
     * The part of `adjustments` that took back an earlier overpayment.
     *
     * The overpayment is worked out from every late refund there has ever been,
     * so without a record of what was already recovered the same refund came
     * off every payout that followed it. Recorded apart from `adjustments`
     * because the reserve moves in and out of that same number.
     *
     * No default on purpose: a row without it predates the field, and its
     * recovery is worked back out of `adjustments` — see
     * `sumOverpaymentRecovered` in lib/vendors/vendor-earnings.ts.
     */
    overpaymentRecovered: {
      type: Number,
      min: 0,
    },
    /**
     * Commission the vendor owed on sales they took the money for themselves —
     * cash at the counter, cash on delivery from their own van — taken out of
     * this payout instead of being invoiced to them.
     *
     * A vendor could be sent every penny of their card sales while an unpaid
     * commission bill for their cash sales sat beside it indefinitely: the
     * platform paying out money it was owed back. The debt is netted here the
     * way a marketplace wallet nets it.
     *
     * Already subtracted inside `adjustments`, like the recovery above; the
     * sales it covers are claimed by `commissionInvoiceId`, which this payout
     * settles when it is paid and hands back if it never is.
     */
    commissionOffset: {
      type: Number,
      min: 0,
    },
    /**
     * The other direction on the same sales: promotions the store paid for on
     * sales the vendor collected the money for, where they outweighed the
     * commission — owed to the vendor, and paid in this payout. Already added
     * inside `adjustments`.
     */
    commissionCredit: {
      type: Number,
      min: 0,
    },
    commissionInvoiceId: {
      type: Schema.Types.ObjectId,
      ref: "CommissionInvoice",
    },
    /**
     * The slice of this payout held back against a pre-order chargeback.
     *
     * Card networks count a dispute window from the EXPECTED DELIVERY date, so
     * a pre-order sold months ahead can be charged back long after its payout
     * has cleared and the vendor has spent it. Holding a percentage for a while
     * is the only lever left once money has gone out.
     *
     * Already subtracted inside `adjustments`, not on top of it — this field
     * records WHY part of that number is there, so a vendor asking "where is
     * the rest of my money" can be told a date rather than a shrug.
     */
    preorderReserveHeld: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** When the held slice becomes payable again. */
    preorderReserveReleaseAt: {
      type: Date,
    },
    /**
     * Stamped once a later payout has actually paid the slice out, so a
     * matured reserve is released exactly once. Absent means still held.
     */
    preorderReserveReleasedAt: {
      type: Date,
    },
    preorderReserveReleasedInPayoutId: {
      type: Schema.Types.ObjectId,
      ref: "Payout",
    },
    status: {
      type: String,
      enum: PAYOUT_STATUSES,
      default: "pending",
      index: true,
    },
    paidAt: {
      type: Date,
    },
    /**
     * When a payout that had been paid was undone, and by whom.
     *
     * A bank transfer can come back days later — a closed account, a wrong
     * IBAN — and the store is then holding money it has already recorded as
     * gone. `paidAt` is left alone: the payment did happen on that day, and
     * the books say so until this reverses it, exactly as a failed refund is
     * reversed rather than erased.
     */
    reversedAt: {
      type: Date,
    },
    reversedBy: {
      type: String,
      trim: true,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    /**
     * How the money actually left, and the reference it left under.
     *
     * A payout marked paid with nothing tying it to a bank line is not
     * auditable: the vendor says it never arrived, and the only record on the
     * platform is a status somebody changed. Both are optional — a store that
     * pays in cash has neither.
     */
    paidFrom: {
      type: String,
      enum: ["bank", "cash", "gateway", "other"],
    },
    paymentReference: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    /**
     * Every status this payout has been through, in order.
     *
     * `createdAt` and `paidAt` describe the two ends and nothing between them,
     * so "when did this go to processing, and who moved it?" had no answer at
     * all — which is the question asked whenever a vendor's money is late.
     */
    statusHistory: {
      type: [
        new Schema(
          {
            status: { type: String, required: true },
            at: { type: Date, required: true },
            by: { type: String },
            note: { type: String, trim: true, maxlength: 2000 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    createdBy: {
      type: String,
      trim: true,
    },
    paidBy: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

PayoutSchema.index({ vendorId: 1, status: 1, createdAt: -1 });
PayoutSchema.index({ periodStart: 1, periodEnd: 1 });

export const Payout = models.Payout || model("Payout", PayoutSchema);
