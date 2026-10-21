import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

/**
 * Money a seller paid back to the store by hand.
 *
 * A refund after a payout leaves the seller holding money they turned out not
 * to be owed, and until now the only way it came back was out of their next
 * payout — which a seller who stops selling never has. When they pay it back
 * by bank transfer or in cash, the admin records it here: the ledger takes the
 * money in, and the overpayment the next payout would recover comes down by
 * the same amount (see `sumOverpaymentRecovered`).
 */
export const VENDOR_REPAYMENT_ACCOUNTS = ["bank", "cash", "gateway"] as const;

const VendorRepaymentSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
    currency: { type: String, required: true, uppercase: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    /** The account the money arrived in. */
    receivedInto: { type: String, enum: VENDOR_REPAYMENT_ACCOUNTS, required: true },
    reference: { type: String, trim: true, maxlength: 120 },
    note: { type: String, trim: true, maxlength: 2000 },
    receivedAt: { type: Date, required: true },
    status: { type: String, enum: ["recorded", "voided"], default: "recorded", index: true },
    voidedAt: { type: Date },
    voidedBy: { type: String, trim: true },
    voidReason: { type: String, trim: true, maxlength: 2000 },
    createdBy: { type: String, trim: true },
  },
  { timestamps: true },
);

VendorRepaymentSchema.index({ vendorId: 1, currency: 1, status: 1, receivedAt: -1 });

export const VendorRepayment =
  models.VendorRepayment || model("VendorRepayment", VendorRepaymentSchema);
