/**
 * Writing to the ledger.
 *
 * Two rules, and both are about what happens when something goes wrong:
 *
 * **Posting never fails the caller.** These functions are called from checkout
 * completion, webhooks and cron ticks. An order that a shopper has paid for
 * must exist even if its entries could not be written — the entries are
 * recoverable by replaying the source document through the same rules, the
 * order is not. So `postLedgerEntries` logs and returns rather than throwing,
 * and every call site treats it as fire-and-forget.
 *
 * **Every write is idempotent.** Keys are derived from the source event, so the
 * unique index absorbs replays. That is what makes the recovery above safe:
 * re-running a backfill over history cannot double-count, because every entry
 * it would write is an entry that already exists.
 */

import { Types } from "mongoose";
import { LedgerEntry, type LedgerSourceKind } from "@/models/ledger-entry.model";
import { quantizeToCurrency, roundMoney } from "@/lib/intl/money";
import {
  LEDGER_ACCOUNT_TYPES,
  debitSign,
  type LedgerAccount,
  type LedgerBook,
} from "@/lib/finance/accounts";

export interface LedgerPosting {
  date: Date;
  book: LedgerBook;
  debit: LedgerAccount;
  credit: LedgerAccount;
  amount: number;
  currency: string;
  baseCurrency?: string | null;
  fxRate?: number | null;
  source: {
    kind: LedgerSourceKind;
    id?: Types.ObjectId | string | null;
    ref?: string | null;
  };
  vendorId?: Types.ObjectId | string | null;
  /**
   * Unique per event. Built from the source document and what the entry is
   * FOR — never from a timestamp or a counter, both of which change between
   * a live post and a later replay and would defeat the whole mechanism.
   */
  key: string;
  note?: string | null;
}

function toObjectId(value: unknown): Types.ObjectId | null {
  if (!value) return null;
  try {
    return new Types.ObjectId(String(value));
  } catch {
    return null;
  }
}

/**
 * A deterministic key: the source, its id, and what the entry represents.
 *
 * `order:64ab…:commission:64cd…` reads as a sentence, which matters when
 * someone is staring at a duplicate-key error at 2am trying to work out which
 * rule fired twice.
 */
export function postingKey(
  kind: LedgerSourceKind,
  id: unknown,
  ...parts: Array<string | number | undefined | null>
): string {
  return [kind, String(id ?? "none"), ...parts.filter((p) => p !== undefined && p !== null)]
    .join(":")
    .toLowerCase();
}

/** Entries worth writing: a positive amount, in a currency, between two accounts. */
function usable(posting: LedgerPosting): boolean {
  if (!posting.key) return false;
  if (!Number.isFinite(posting.amount) || posting.amount <= 0) return false;
  if (!posting.currency) return false;
  // A self-cancelling entry moves nothing and only makes the trial balance
  // harder to read.
  if (posting.debit === posting.credit) return false;
  return true;
}

/**
 * The last instant that has been closed, cached for the process.
 *
 * Read on every post, so it cannot be a query each time; invalidated by the
 * close and reopen paths, which are the only things that move it. A stale value
 * costs at most one entry dated into a period that has just been closed —
 * recoverable by a reversal, unlike the alternative of a database round trip on
 * every checkout.
 */
let closedThroughCache: { value: Date | null; at: number } | null = null;
const CLOSED_THROUGH_TTL_MS = 60_000;

export function invalidateClosedPeriodCache() {
  closedThroughCache = null;
}

async function getClosedThrough(): Promise<Date | null> {
  if (closedThroughCache && Date.now() - closedThroughCache.at < CLOSED_THROUGH_TTL_MS) {
    return closedThroughCache.value;
  }
  const { FiscalPeriod } = await import("@/models/fiscal-period.model");
  const latest = await FiscalPeriod.findOne()
    .sort({ to: -1 })
    .select("to")
    .lean<{ to?: Date } | null>();
  closedThroughCache = { value: latest?.to ?? null, at: Date.now() };
  return closedThroughCache.value;
}

/**
 * Where an entry may be dated.
 *
 * An entry for a closed period is not refused — refusing would lose the money
 * event entirely — and it is not backdated into the closed month either, which
 * would move a figure someone has already filed. It lands on the first instant
 * after the close, carrying a note that says where it belongs. That is the
 * accounting answer: the correction appears in the open period, and the closed
 * one still reads as it did.
 */
/** The longest note a ledger entry stores — the model's own limit. */
const NOTE_MAX_LENGTH = 500;

export function applyPeriodClose(
  posting: LedgerPosting,
  closedThrough: Date | null,
): LedgerPosting {
  if (!closedThrough || posting.date > closedThrough) return posting;
  const shifted = new Date(closedThrough.getTime() + 1000);
  const original = posting.date.toISOString().slice(0, 10);
  const suffix = `Dated ${original}, posted after the period close`;
  // An entry's note holds at most NOTE_MAX_LENGTH characters. A long note with
  // the suffix appended failed validation, and the entry — a hand-entered
  // adjustment, typically — was silently not written at all. The caller's own
  // words are shortened instead; the date they belong to is the part that
  // must survive.
  const room = NOTE_MAX_LENGTH - suffix.length - 3;
  const kept = posting.note
    ? posting.note.length > room
      ? `${posting.note.slice(0, Math.max(0, room - 1)).trimEnd()}…`
      : posting.note
    : null;
  return {
    ...posting,
    date: shifted,
    note: kept ? `${kept} · ${suffix}` : suffix,
  };
}

/**
 * Write entries, ignoring the ones already written.
 *
 * `ordered: false` so one duplicate does not abandon the rest of the batch:
 * a partial replay (three of five entries already posted) must still write the
 * two that are missing, which is exactly the case the recovery path produces.
 */
export async function postLedgerEntries(
  postings: LedgerPosting[],
): Promise<number> {
  const closedThrough = await getClosedThrough().catch(() => null);
  const rows = postings.filter(usable).map((raw) => {
    const posting = applyPeriodClose(raw, closedThrough);
    return {
      date: posting.date,
      book: posting.book,
      debit: posting.debit,
      credit: posting.credit,
      amount: quantizeToCurrency(posting.amount, posting.currency),
      currency: posting.currency.toUpperCase(),
      baseCurrency: posting.baseCurrency ?? null,
      fxRate: posting.fxRate ?? null,
      source: {
        kind: posting.source.kind,
        id: toObjectId(posting.source.id),
        ref: posting.source.ref ?? null,
      },
      vendorId: toObjectId(posting.vendorId),
      key: posting.key,
      note: posting.note ?? null,
    };
  });
  if (rows.length === 0) return 0;

  try {
    const inserted = await LedgerEntry.insertMany(rows, { ordered: false });
    return inserted.length;
  } catch (error) {
    const e = error as {
      code?: number;
      writeErrors?: Array<{ code?: number }>;
      insertedDocs?: unknown[];
    };
    const duplicatesOnly =
      e?.code === 11000 ||
      (Array.isArray(e?.writeErrors) &&
        e.writeErrors.length > 0 &&
        e.writeErrors.every((w) => w?.code === 11000));
    if (duplicatesOnly) {
      // Every collision is an entry already on the books. That is the design
      // working, not a fault, so it is not worth a log line at any level.
      return e.insertedDocs?.length ?? 0;
    }
    console.error("Failed to post ledger entries:", error);
    return e.insertedDocs?.length ?? 0;
  }
}

/**
 * The trial balance: every account's signed total.
 *
 * Be clear about what `balanced` proves, because it is less than it looks. An
 * entry carries ONE amount applied to both of its accounts, so debits equal
 * credits by construction and no posting rule can make this fail — a rule that
 * credits the wrong account, or splits an order into shares that do not sum to
 * what was charged, comes out balanced. What it does catch is an entry that did
 * not come from these rules: a hand-edited row, a half-finished migration, a
 * restore from a partial dump. Worth running for that, and not evidence that
 * the rules are right.
 *
 * The per-account list is the part worth reading: an account holding a figure
 * nobody expects is how a wrong rule actually shows itself.
 */
export async function getTrialBalance(filter: {
  book?: LedgerBook;
  from?: Date;
  to?: Date;
} = {}): Promise<{
  accounts: Array<{ account: LedgerAccount; balance: number; currency: string }>;
  total: number;
  balanced: boolean;
}> {
  const match: Record<string, unknown> = {};
  if (filter.book) match.book = filter.book;
  if (filter.from || filter.to) {
    match.date = {
      ...(filter.from ? { $gte: filter.from } : {}),
      ...(filter.to ? { $lte: filter.to } : {}),
    };
  }

  const rows = await LedgerEntry.aggregate<{
    _id: { account: LedgerAccount; currency: string };
    debits: number;
    credits: number;
  }>([
    { $match: match },
    {
      $facet: {
        debits: [
          {
            $group: {
              _id: { account: "$debit", currency: "$currency" },
              amount: { $sum: "$amount" },
            },
          },
        ],
        credits: [
          {
            $group: {
              _id: { account: "$credit", currency: "$currency" },
              amount: { $sum: "$amount" },
            },
          },
        ],
      },
    },
    {
      $project: {
        rows: {
          $concatArrays: [
            {
              $map: {
                input: "$debits",
                as: "d",
                in: { _id: "$$d._id", debits: "$$d.amount", credits: 0 },
              },
            },
            {
              $map: {
                input: "$credits",
                as: "c",
                in: { _id: "$$c._id", debits: 0, credits: "$$c.amount" },
              },
            },
          ],
        },
      },
    },
    { $unwind: "$rows" },
    { $replaceRoot: { newRoot: "$rows" } },
    {
      $group: {
        _id: "$_id",
        debits: { $sum: "$debits" },
        credits: { $sum: "$credits" },
      },
    },
  ]);

  const accounts = rows
    // An account that is no longer in the chart cannot be typed, so it cannot
    // be signed. It still counts towards `total` below, which is deliberate:
    // dropping it from both would hide the very thing worth noticing.
    .filter((row) => row._id?.account in LEDGER_ACCOUNT_TYPES)
    .map((row) => ({
      account: row._id.account,
      currency: row._id.currency,
      balance:
        debitSign(row._id.account) === 1
          ? row.debits - row.credits
          : row.credits - row.debits,
    }));

  // Signed the same way for the sum, so equal-and-opposite pairs cancel.
  const total = rows.reduce(
    (sum, row) => sum + (row.debits - row.credits),
    0,
  );
  return {
    accounts,
    total: roundMoney(total),
    balanced: Math.abs(total) < 0.005,
  };
}
