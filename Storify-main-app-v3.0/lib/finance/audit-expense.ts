import { audit, type AuditContext } from "@/lib/audit";
import { currencyPriceScale } from "@/lib/intl/money";
import {
  changesOf,
  diffSnapshots,
  sayChange,
} from "@/lib/site-config/audit-content";

/**
 * Audit rows for an expense, whoever recorded it: the platform's admin or a
 * vendor for their own store. One module, so both read the same in the log and
 * neither can quote what the log must not hold.
 *
 * A row says what the money was: the amount in its currency, the category and
 * the day, and (when it moves) which of them changed. It never carries the
 * receipt, the payee or the note. An expense keeps those itself, and the log is
 * read by more people than the expense is. When one of them is edited the row
 * still lists it by name ("receipt") so the edit is on record; its value, before
 * or after, is not.
 *
 * `audit()` never throws, so none of these can fail the save that called it.
 */

/** The parts of a stored expense a row reads. Anything else on it is left alone. */
export interface AuditedExpense {
  _id?: unknown;
  amount: number;
  currency: string;
  date: Date | string;
  category: string;
  description?: string | null;
  paidFrom?: string | null;
  book?: string | null;
  scope?: string | null;
  vendorId?: unknown;
  recurring?: {
    enabled?: boolean;
    interval?: string;
    endsAt?: Date | string | null;
  } | null;
  settlement?: { paidAt: Date | string; paidFrom: string } | null;
  // Read only to notice that they moved. Their values never reach a row.
  receiptUrl?: string | null;
  payee?: string | null;
  note?: string | null;
}

/** Listed when edited, never quoted. */
const NAMED_ONLY = ["receipt", "payee", "note"] as const;

const LABELS: Record<string, string> = {
  vendorId: "vendor",
  repeatsUntil: "repeat end date",
};

/** A date as the day it names, or nothing when there is none. */
function day(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** An amount to the places its currency has: 25.00, 500. */
function figure(amount: unknown, currency: unknown): string {
  return Number(amount).toFixed(currencyPriceScale(String(currency ?? "")));
}

/** An amount the way its currency writes it: 25.00 USD, 500 JPY. */
const money = (amount: unknown, currency: unknown) =>
  `${figure(amount, currency)} ${currency}`;

function snapshot(expense: AuditedExpense) {
  const repeating = expense.recurring?.enabled ? expense.recurring : null;
  return {
    amount: Number(expense.amount),
    currency: expense.currency,
    date: day(expense.date),
    category: expense.category,
    description: expense.description ?? null,
    paidFrom: expense.paidFrom ?? null,
    book: expense.book ?? null,
    vendorId: expense.vendorId ? String(expense.vendorId) : null,
    repeats: repeating?.interval ?? null,
    repeatsUntil: repeating ? day(repeating.endsAt) : null,
    receipt: expense.receiptUrl ?? null,
    payee: expense.payee ?? null,
    note: expense.note ?? null,
  };
}

/** What an expense was, for the rows that create or remove one. */
function factsOf(expense: AuditedExpense) {
  const view = snapshot(expense);
  return {
    amount: view.amount,
    currency: view.currency,
    category: view.category,
    date: view.date,
    paidFrom: view.paidFrom,
    // A vendor's cost never reaches a book; the field is only there to be required.
    ...(expense.scope === "vendor" ? {} : { book: view.book }),
    ...(view.repeats ? { repeats: view.repeats } : {}),
  };
}

/** "an expense of 25.00 USD in the software category dated 2026-10-02" */
function described(expense: AuditedExpense): string {
  const view = snapshot(expense);
  return `${money(view.amount, view.currency)} in the ${view.category} category dated ${view.date ?? "an unknown day"}`;
}

const nameOf = (expense: AuditedExpense) =>
  expense.description?.trim() || "(no description)";

const idOf = (expense: AuditedExpense) => String(expense._id);

/** A new expense. */
export function auditExpenseRecorded(
  context: AuditContext,
  expense: AuditedExpense,
) {
  const view = snapshot(expense);
  const how = [
    view.paidFrom === "unpaid"
      ? "not yet paid"
      : view.paidFrom && `paid from ${view.paidFrom}`,
    view.repeats && `repeating ${view.repeats}`,
    expense.scope !== "vendor" && view.book === "marketplace"
      ? "in the marketplace book"
      : null,
  ].filter(Boolean);

  return audit(context, {
    action: "CREATE",
    resource: "expense",
    resourceId: idOf(expense),
    resourceName: nameOf(expense),
    changes: {
      after: factsOf(expense),
      summary: `Recorded an expense of ${described(expense)}${
        how.length ? `, ${how.join(", ")}` : ""
      }`,
    },
  });
}

/**
 * A save. `before` and `after` are the stored expense either side of the
 * write; nothing is written when no field differs between them, and only the
 * fields that differ are quoted.
 */
export async function auditExpenseUpdated(
  context: AuditContext,
  before: AuditedExpense,
  after: AuditedExpense,
) {
  const diff = diffSnapshots(snapshot(before), snapshot(after), NAMED_ONLY);
  if (!diff) return null;

  const { was, now } = diff;
  const amountMoved = diff.fields.includes("amount");
  const parts = diff.fields.flatMap((field) => {
    if (field === "amount") {
      // In its own currency, whichever side that is.
      return [
        was.currency === now.currency
          ? `amount (${figure(was.amount, was.currency)} to ${money(now.amount, now.currency)})`
          : `amount (${money(was.amount, was.currency)} to ${money(now.amount, now.currency)})`,
      ];
    }
    // Said with the amount when both moved; otherwise it stands on its own.
    if (field === "currency" && amountMoved) return [];
    return [sayChange(diff, field, LABELS[field])];
  });

  return audit(context, {
    action: "UPDATE",
    resource: "expense",
    resourceId: idOf(after),
    resourceName: nameOf(after),
    changes: changesOf(
      diff,
      `Updated expense "${nameOf(after)}": ${parts.join(", ")}`,
    ),
  });
}

/** An expense that is gone. */
export function auditExpenseDeleted(
  context: AuditContext,
  expense: AuditedExpense,
) {
  const paid = expense.settlement
    ? {
        settlement: {
          paidFrom: expense.settlement.paidFrom,
          paidAt: day(expense.settlement.paidAt),
        },
      }
    : {};
  return audit(context, {
    action: "DELETE",
    resource: "expense",
    resourceId: idOf(expense),
    resourceName: nameOf(expense),
    changes: {
      before: { ...factsOf(expense), ...paid },
      summary: `Deleted expense "${nameOf(expense)}" of ${described(expense)}${
        expense.settlement ? "; its payment was reversed with it" : ""
      }`,
    },
  });
}

/**
 * A bill marked paid, or its payment taken back. `settlement` is the payment
 * either way: the one that now stands, or the one that was undone.
 */
export function auditExpenseSettlement(
  context: AuditContext,
  expense: AuditedExpense,
  settlement: { paidAt: Date | string; paidFrom: string },
  paid: boolean,
) {
  const payment = { paidFrom: settlement.paidFrom, paidAt: day(settlement.paidAt) };
  const bill = `expense "${nameOf(expense)}" of ${described(expense)}`;
  return audit(context, {
    action: "UPDATE",
    resource: "expense",
    resourceId: idOf(expense),
    resourceName: nameOf(expense),
    changes: {
      before: { settlement: paid ? null : payment },
      after: { settlement: paid ? payment : null },
      fields: ["settlement"],
      summary: paid
        ? `Marked the ${bill} as paid from ${payment.paidFrom} on ${payment.paidAt}`
        : `Marked the ${bill} as unpaid again; the payment from ${payment.paidFrom} on ${payment.paidAt} was taken back`,
    },
  });
}
