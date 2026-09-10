/**
 * Expense — the one money event nothing in the app produces on its own.
 *
 * Sales, refunds, payouts, fees and labels all have a document behind them
 * already. Rent, salaries and advertising have none, so without this the profit
 * figure is revenue minus the handful of costs that happen to pass through a
 * gateway — which is not a profit figure at all.
 *
 * Entered by hand, and therefore editable, which makes it the one financial
 * record that is NOT append-only. The ledger stays append-only regardless: an
 * edit posts a reversal and a fresh pair of entries rather than rewriting
 * history, so a corrected expense leaves both versions visible.
 *
 * Scoped by `book`: a marketplace owner's rent belongs to the marketplace, the
 * cost of stock for their own shop belongs to the own store, and a
 * single-vendor install only ever writes the own book.
 */

import mongoose, { Schema, Document, Model, Types } from "mongoose";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAID_FROM,
  type ExpenseCategory,
  type ExpensePaidFrom,
} from "@/lib/finance/expense-categories";
import { LEDGER_BOOK, type LedgerBook } from "@/lib/finance/accounts";

interface IExpense extends Document {
  /** When the cost was incurred — what every report groups by. */
  date: Date;
  book: LedgerBook;
  category: ExpenseCategory;
  /** Major units, in `currency`. */
  amount: number;
  currency: string;
  description: string;
  /** Who was paid. Free text: a supplier list is a different feature. */
  payee?: string | null;
  paidFrom: ExpensePaidFrom;
  /** Uploaded receipt or invoice, through the existing media pipeline. */
  receiptUrl?: string | null;
  /**
   * The vendor this cost belongs to, when a marketplace tracks costs per
   * seller. Absent means it is the platform's own.
   */
  vendorId?: Types.ObjectId | null;
  /**
   * Whose books this belongs on.
   *
   * `platform` costs post to the ledger and reduce the marketplace's profit.
   * `vendor` costs are the seller's own — rent on THEIR shop, THEIR courier —
   * and must never touch the platform's books: posting them would have a
   * marketplace's profit fall because one of its sellers bought a laptop. They
   * are recorded for the vendor's own reporting and nothing else.
   */
  scope: "platform" | "vendor";
  /**
   * Set when this row was generated from a recurring template rather than
   * typed. The template is the row with `recurring.enabled`.
   */
  recurring?: {
    enabled: boolean;
    /** How often a new copy is due. */
    interval: "weekly" | "monthly" | "quarterly" | "yearly";
    /** The next date a copy should be created for. */
    nextDueAt?: Date | null;
    /** The template that produced this row, when it was produced. */
    templateId?: Types.ObjectId | null;
  } | null;
  note?: string | null;
  /**
   * How many times this row has been corrected. Rides in the ledger key.
   *
   * Explicit rather than borrowed from `__v`, which was the first attempt and
   * does not do what it looks like: mongoose only bumps the version key when an
   * array is modified, so editing an amount left it at 0 forever. Every edit
   * after the first then reversed and re-posted keys that already existed, the
   * unique index absorbed both, and the ledger silently kept the FIRST
   * correction's figures while the row on screen showed the latest.
   */
  revision: number;
  /**
   * The ledger account this expense's cost was debited to, decided at creation.
   *
   * Stored rather than re-derived from `category`, because the reversal that
   * corrects or deletes an expense mirrors whatever the ORIGINAL posted. Stock
   * purchases moved from `operating_expense` to `inventory`; re-deriving would
   * make a reversal of an older row credit an account its original never
   * debited, leaving both wrong. Absent means it was written before the split,
   * which is exactly the rows that went to `operating_expense`.
   */
  debitAccount?: string | null;
  createdBy: string;
  updatedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSchema = new Schema<IExpense>(
  {
    date: { type: Date, required: true },
    book: {
      type: String,
      enum: Object.values(LEDGER_BOOK),
      default: LEDGER_BOOK.OWN,
      required: true,
    },
    category: {
      type: String,
      enum: EXPENSE_CATEGORIES,
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    payee: { type: String, trim: true, maxlength: 200, default: null },
    paidFrom: {
      type: String,
      enum: Object.values(EXPENSE_PAID_FROM),
      default: EXPENSE_PAID_FROM.BANK,
      required: true,
    },
    receiptUrl: { type: String, trim: true, default: null },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", default: null },
    scope: {
      type: String,
      enum: ["platform", "vendor"],
      default: "platform",
      required: true,
    },
    recurring: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false },
          interval: {
            type: String,
            enum: ["weekly", "monthly", "quarterly", "yearly"],
            default: "monthly",
          },
          nextDueAt: { type: Date, default: null },
          templateId: { type: Schema.Types.ObjectId, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    note: { type: String, trim: true, maxlength: 1000, default: null },
    revision: { type: Number, default: 0, min: 0 },
    debitAccount: { type: String, default: null },
    createdBy: { type: String, required: true },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true },
);

// The list screen and every report: a period of one book, newest first.
ExpenseSchema.index({ book: 1, date: -1 });
// Category breakdown on the profit and loss.
ExpenseSchema.index({ category: 1, date: -1 });
// A vendor's own costs, for their statement.
ExpenseSchema.index({ vendorId: 1, scope: 1, date: -1 });
// The recurring sweep: templates whose next copy is due.
ExpenseSchema.index({ "recurring.enabled": 1, "recurring.nextDueAt": 1 });

export const Expense: Model<IExpense> =
  mongoose.models.Expense || mongoose.model<IExpense>("Expense", ExpenseSchema);
