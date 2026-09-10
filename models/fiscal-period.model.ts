/**
 * FiscalPeriod — the line under a month.
 *
 * Once figures have been filed, quoted to an accountant or paid tax on, they
 * have to stop moving. Nothing in the app prevents a late webhook, a corrected
 * expense or a re-run backfill from posting into last March; a closed period
 * says those entries land in the open month instead.
 *
 * Deliberately NOT a lock on the data. Ledger entries are append-only and are
 * never edited or deleted by this — closing changes only where NEW entries are
 * dated, so history is preserved rather than defended. That distinction matters
 * when someone asks why a figure moved: the answer is a dated entry in the
 * current month, not a silent difference in a closed one.
 *
 * One row per closed period. The absence of a row means open, so a store that
 * never closes anything carries no state at all.
 */

import mongoose, { Schema, Document, Model } from "mongoose";

interface IFiscalPeriod extends Document {
  /** First instant of the closed period. */
  from: Date;
  /** Last instant of the closed period, inclusive. */
  to: Date;
  /** "2026-03" — the human label, and what makes the period unique. */
  label: string;
  closedAt: Date;
  closedBy: string;
  /** What the books said when it was closed, for comparison later. */
  snapshot?: Array<{
    currency: string;
    income: number;
    expenses: number;
    net: number;
  }>;
  note?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const FiscalPeriodSchema = new Schema<IFiscalPeriod>(
  {
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    label: { type: String, required: true, trim: true },
    closedAt: { type: Date, required: true },
    closedBy: { type: String, required: true },
    /**
     * The totals at the moment of closing, kept so a later "why is March
     * different now?" can be answered with what March actually said then —
     * rather than with a recomputation that has already absorbed the change.
     */
    snapshot: {
      type: [
        new Schema(
          {
            currency: { type: String, required: true, uppercase: true },
            income: { type: Number, default: 0 },
            expenses: { type: Number, default: 0 },
            net: { type: Number, default: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    note: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: true },
);

// One close per period, and the "is this date closed?" lookup.
FiscalPeriodSchema.index({ label: 1 }, { unique: true });
FiscalPeriodSchema.index({ to: -1 });

export const FiscalPeriod: Model<IFiscalPeriod> =
  mongoose.models.FiscalPeriod ||
  mongoose.model<IFiscalPeriod>("FiscalPeriod", FiscalPeriodSchema);
