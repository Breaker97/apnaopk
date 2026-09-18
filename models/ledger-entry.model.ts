/**
 * LedgerEntry — the append-only spine every financial report is a grouping of.
 *
 * Why this exists at all: the operational documents (Order, Payout,
 * PlatformPayment, Shipment) are mutable, so a report derived from them changes
 * whenever one of them is corrected. Last month's profit is supposed to be a
 * fact. Recording each money event once, as an entry that is never edited,
 * is what makes it one.
 *
 * Three properties carry the whole design:
 *
 * **Append-only.** Nothing here is updated or deleted. A mistake is fixed by
 * posting its reverse, which leaves both the error and the correction visible —
 * the audit trail is a side effect of the rule rather than a feature on top.
 *
 * **Two-sided.** Every entry names a debit account and a credit account from
 * the fixed enum in lib/finance/accounts.ts. Because both sides are always
 * present and equal, the trial balance is free: sum every entry by account,
 * apply the sign, and the total must be zero. A non-zero total is a bug alarm
 * no test could otherwise raise.
 *
 * **Idempotent.** `key` is derived from the source event, not from the clock,
 * and is unique. A replayed webhook, a re-run backfill and a retried cron all
 * try to write the same key and lose to the index — which is what makes it safe
 * to post from paths that are themselves retried.
 *
 * The ledger is DERIVED. It never gates an operational write: an order must not
 * fail to exist because its entries could not be posted, so posting is
 * best-effort and anything missed is recoverable by replaying the source
 * through the same rules (scripts/backfill-ledger.mjs).
 */

import mongoose, { Schema, Document, Model, Types } from "mongoose";
import {
  LEDGER_ACCOUNT,
  LEDGER_BOOK,
  type LedgerAccount,
  type LedgerBook,
} from "@/lib/finance/accounts";

/** What produced an entry, so any figure can be traced back to its cause. */
export const LEDGER_SOURCE_KIND = {
  ORDER: "order",
  REFUND: "refund",
  PAYOUT: "payout",
  PLATFORM_PAYMENT: "platform_payment",
  SHIPMENT: "shipment",
  EXPENSE: "expense",
  ADJUSTMENT: "adjustment",
  /** Units written off when a stock transfer was received short or damaged. */
  TRANSFER: "transfer",
} as const;

export type LedgerSourceKind =
  (typeof LEDGER_SOURCE_KIND)[keyof typeof LEDGER_SOURCE_KIND];

interface ILedgerEntry extends Document {
  /**
   * When the money event happened — not when the row was written. A backfill
   * run today must reproduce last year's report exactly, so every report reads
   * this and nothing reads `createdAt`.
   */
  date: Date;
  book: LedgerBook;
  debit: LedgerAccount;
  credit: LedgerAccount;
  /** Always positive, in `currency`. Direction is carried by the account pair. */
  amount: number;
  currency: string;
  /** Set only when `currency` differs from the store's book currency. */
  baseCurrency?: string | null;
  /** Units of `currency` per unit of `baseCurrency`, when one was known. */
  fxRate?: number | null;
  source: {
    kind: LedgerSourceKind;
    id?: Types.ObjectId | null;
    /** Human-facing reference — an order number, a payout number. */
    ref?: string | null;
  };
  /** The vendor this entry concerns, when it concerns one. */
  vendorId?: Types.ObjectId | null;
  /** Deterministic, unique — the idempotency line. */
  key: string;
  note?: string | null;
  createdAt: Date;
}

const LedgerEntrySchema = new Schema<ILedgerEntry>(
  {
    date: { type: Date, required: true },
    book: {
      type: String,
      enum: Object.values(LEDGER_BOOK),
      required: true,
    },
    debit: {
      type: String,
      enum: Object.values(LEDGER_ACCOUNT),
      required: true,
    },
    credit: {
      type: String,
      enum: Object.values(LEDGER_ACCOUNT),
      required: true,
    },
    // Strictly positive: a zero entry says nothing and a negative one would
    // encode direction twice, once in the sign and once in the account pair —
    // and the two would eventually disagree.
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true },
    baseCurrency: { type: String, uppercase: true, trim: true, default: null },
    fxRate: { type: Number, min: 0, default: null },
    source: {
      type: new Schema(
        {
          kind: {
            type: String,
            enum: Object.values(LEDGER_SOURCE_KIND),
            required: true,
          },
          id: { type: Schema.Types.ObjectId, default: null },
          ref: { type: String, trim: true, default: null },
        },
        { _id: false },
      ),
      required: true,
    },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", default: null },
    key: { type: String, required: true, trim: true },
    note: { type: String, trim: true, maxlength: 500, default: null },
  },
  // `updatedAt` is deliberately off: nothing updates an entry, and carrying a
  // field that can never change invites code that tries.
  { timestamps: { createdAt: true, updatedAt: false } },
);

// THE idempotency line. Every posting path derives the same key for the same
// event, so a replayed webhook, a retried cron and a re-run backfill all
// collide here instead of double-counting money.
LedgerEntrySchema.index({ key: 1 }, { unique: true });

// The report query: a period of one book, grouped by account.
LedgerEntrySchema.index({ book: 1, date: 1 });

// Account-level roll-ups (profit and loss, trial balance) read both sides.
LedgerEntrySchema.index({ debit: 1, date: 1 });
LedgerEntrySchema.index({ credit: 1, date: 1 });

// A vendor's statement, and their payable/receivable balances.
LedgerEntrySchema.index({ vendorId: 1, date: 1 });

// Tracing a figure back to the document that caused it, and the backfill's
// "what has this source already posted" check.
LedgerEntrySchema.index({ "source.kind": 1, "source.id": 1 });

export const LedgerEntry: Model<ILedgerEntry> =
  mongoose.models.LedgerEntry ||
  mongoose.model<ILedgerEntry>("LedgerEntry", LedgerEntrySchema);
