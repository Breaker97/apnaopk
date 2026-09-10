/**
 * Commission the platform is owed on sales a merchant collected themselves.
 *
 * A payout hands a vendor their share of money the platform already holds. For
 * a cash sale that direction does not exist — the merchant took the notes at
 * their own counter — so the commission cannot be deducted from anything, and
 * before this it was simply never collected. `lib/payment-custody.ts` decides
 * which sales those are.
 *
 * This is the DEBT, not a payment attempt. It sits alongside `BoostCampaign`
 * and `VendorSubscription` as a thing a `PlatformPayment` pays for, and for the
 * same reason: a vendor who abandons one checkout and completes another leaves
 * two attempts behind, and neither the amount owed nor the sales it covers may
 * move because of that. One debt, many attempts.
 *
 * The sub-orders it covers are CLAIMED by stamping `commissionSettlementId` on
 * each of them, which is what takes them out of the owed balance. `orderIds`
 * here is the frozen record of what was billed; the stamps are what the balance
 * query actually reads.
 */

import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

export const COMMISSION_INVOICE_STATUS = {
  /** Raised and claiming its sales; awaiting payment. */
  OPEN: "open",
  PAID: "paid",
  /** Withdrawn by an admin — the claim has been handed back. */
  CANCELLED: "cancelled",
} as const;

type CommissionInvoiceStatus =
  (typeof COMMISSION_INVOICE_STATUS)[keyof typeof COMMISSION_INVOICE_STATUS];

interface ICommissionInvoice extends mongoose.Document {
  vendorId: mongoose.Types.ObjectId;
  /** Frozen at issue: the orders whose sub-orders this invoice claimed. */
  orderIds: mongoose.Types.ObjectId[];
  amount: number;
  currency: string;
  status: CommissionInvoiceStatus;
  /**
   * The attempt that actually paid it.
   *
   * Recorded so a reversal can tell whether THIS attempt bought the settlement
   * — an invoice can carry several attempts, and reversing an abandoned
   * duplicate must not hand back a claim a different attempt genuinely paid
   * for. Same guard `markPlatformPaymentReversed` applies to boosts.
   */
  paymentId: mongoose.Types.ObjectId | null;
  paidAt: Date | null;
  /** Admin who raised it. */
  createdBy: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CommissionInvoiceSchema = new Schema<ICommissionInvoice>(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    orderIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Order" }],
      default: [],
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true },
    status: {
      type: String,
      enum: Object.values(COMMISSION_INVOICE_STATUS),
      default: COMMISSION_INVOICE_STATUS.OPEN,
      index: true,
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "PlatformPayment",
      default: null,
    },
    paidAt: { type: Date, default: null },
    createdBy: { type: String, required: true },
    note: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: true },
);

// "This vendor's invoices, newest first" — the admin finance tab's only query.
CommissionInvoiceSchema.index({ vendorId: 1, createdAt: -1 });
// "Which vendors still owe" — the outstanding-balance sweep.
CommissionInvoiceSchema.index({ status: 1, vendorId: 1 });

export const CommissionInvoice =
  models.CommissionInvoice ||
  model<ICommissionInvoice>("CommissionInvoice", CommissionInvoiceSchema);
