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
    status: {
      type: String,
      enum: PAYOUT_STATUSES,
      default: "pending",
      index: true,
    },
    paidAt: {
      type: Date,
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
