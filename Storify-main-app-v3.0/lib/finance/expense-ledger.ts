/**
 * The ledger side of an expense beyond the bill itself: paying a bill that was
 * recorded as not yet paid, and repairing what a failed write left behind.
 *
 * The bill's own entry and its corrections are in `post-events`
 * (`postExpense`, `reverseExpense`); this module holds what came after.
 */

import { Types } from "mongoose";
import {
  LEDGER_SOURCE_KIND,
  LedgerEntry,
} from "@/models/ledger-entry.model";
import { postLedgerEntries, type LedgerPosting } from "@/lib/finance/ledger";
import {
  expenseSettlementPostings,
  expenseSettlementReversalPostings,
} from "@/lib/finance/postings";
import { highestRevisionInKeys } from "@/lib/finance/post-events";
import type { LedgerBook } from "@/lib/finance/accounts";

type SettledExpense = Parameters<typeof expenseSettlementPostings>[0];

/** A bill recorded as not yet paid, paid — payable down, bank down. */
export async function postExpenseSettlement(
  expense: SettledExpense,
  options: { strict?: boolean } = {},
): Promise<number> {
  return postLedgerEntries(expenseSettlementPostings(expense), options);
}

/** That payment taken back: the bill is owed again. */
export async function reverseExpenseSettlement(
  expense: SettledExpense,
  options: { strict?: boolean } = {},
): Promise<number> {
  return postLedgerEntries(expenseSettlementReversalPostings(expense), options);
}

/** What the reconcile pass knows about an expense row. */
export interface ExpenseLedgerRow {
  _id: unknown;
  book?: LedgerBook | null;
  amount?: number | null;
  currency?: string | null;
  description?: string | null;
  vendorId?: unknown;
  revision?: number | null;
  settlement?: SettledExpense["settlement"] | null;
}

interface StoredEntry {
  date: Date;
  book: LedgerBook;
  debit: LedgerPosting["debit"];
  credit: LedgerPosting["credit"];
  amount: number;
  currency: string;
  source: { kind: string; id?: Types.ObjectId | null; ref?: string | null };
  vendorId?: Types.ObjectId | null;
  key: string;
}

const expenseKey = (id: unknown, ...parts: Array<string | number>) =>
  ["expense", String(id), ...parts].join(":").toLowerCase();

/**
 * Put back what a failed write left out, for these rows.
 *
 * An expense has at most two entries that should be live: its current
 * revision, and its payment if it is paid. Every other entry it ever had was
 * superseded and must have a reversal. A correction whose reversal failed to
 * write left the old revision standing next to the new one — the cost counted
 * twice — and replaying the row could never see it, because the old values
 * are gone from the row. They are not gone from the ledger: the missing
 * reversal is the stored entry's mirror image, so that is what is posted.
 *
 * The payment is re-posted too; its key makes that a no-op when it is there.
 */
export async function healExpenseLedger(
  rows: ExpenseLedgerRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const ids = rows.flatMap((row) => {
    try {
      return [new Types.ObjectId(String(row._id))];
    } catch {
      return [];
    }
  });
  const entries = await LedgerEntry.find({
    "source.kind": "expense",
    "source.id": { $in: ids },
  })
    .select("date book debit credit amount currency source vendorId key")
    .lean<StoredEntry[]>();

  const byExpense = new Map<string, StoredEntry[]>();
  for (const entry of entries) {
    const id = String(entry.source.id);
    byExpense.set(id, [...(byExpense.get(id) ?? []), entry]);
  }

  const missing: LedgerPosting[] = [];
  let written = 0;

  for (const row of rows) {
    const own = byExpense.get(String(row._id)) ?? [];
    const keys = new Set(own.map((entry) => entry.key));
    // A row written before the counter existed carries none; its live
    // revision is the highest one its own entries name.
    const revision =
      typeof row.revision === "number"
        ? row.revision
        : highestRevisionInKeys([...keys]);
    const live = new Set([expenseKey(row._id, "v", revision)]);
    if (row.settlement) {
      live.add(expenseKey(row._id, "settle", row.settlement.sequence));
      written += await postExpenseSettlement({
        ...row,
        settlement: row.settlement,
      });
    }

    for (const entry of own) {
      if (entry.key.endsWith(":reversal")) continue;
      if (live.has(entry.key)) continue;
      if (keys.has(`${entry.key}:reversal`)) continue;
      missing.push({
        date: entry.date,
        book: entry.book,
        debit: entry.credit,
        credit: entry.debit,
        amount: entry.amount,
        currency: entry.currency,
        source: {
          kind: LEDGER_SOURCE_KIND.EXPENSE,
          id: entry.source.id ?? null,
          ref: entry.source.ref ?? null,
        },
        vendorId: entry.vendorId ?? null,
        key: `${entry.key}:reversal`,
        note: "Reversal of a superseded expense entry, restored by reconcile",
      });
    }
  }

  return written + (await postLedgerEntries(missing));
}
