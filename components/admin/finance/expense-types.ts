import type { ExpenseCategory } from "@/lib/finance/expense-categories";
import type { RecurringInterval } from "@/lib/finance/recurring-schedule";

export const PAID_FROM = ["bank", "cash", "gateway", "unpaid"] as const;
export type PaidFrom = (typeof PAID_FROM)[number];
export type SettledFrom = Exclude<PaidFrom, "unpaid">;

export const INTERVALS: RecurringInterval[] = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

/** One expense as the list API returns it. */
export interface ExpenseRow {
  _id: string;
  version?: number;
  date: string;
  book: "own" | "marketplace";
  category: ExpenseCategory;
  amount: number;
  currency: string;
  description: string;
  payee?: string | null;
  paidFrom: PaidFrom;
  receiptUrl?: string | null;
  settlement?: {
    paidAt: string;
    paidFrom: SettledFrom;
    sequence: number;
  } | null;
  recurring?: {
    enabled?: boolean;
    interval?: RecurringInterval;
    nextDueAt?: string | null;
    endsAt?: string | null;
    templateId?: string | null;
  } | null;
  note?: string | null;
}

/** A copy the repeating schedule made, rather than one somebody typed. */
export const isGeneratedCopy = (row: ExpenseRow) =>
  Boolean(row.recurring?.templateId);

/** "YYYY-MM-DD" of the viewer's own today — the day the date picker calls today. */
export function localToday(now = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * A "YYYY-MM-DD" day as the instant it is stored at: midnight UTC. Every
 * expense date is saved this way, so comparing with it compares days.
 */
export function storedDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** A stored instant back to its "YYYY-MM-DD" day. */
export function dayOf(stored: string | Date): string {
  return new Date(stored).toISOString().slice(0, 10);
}

/** A stored day for display, read in UTC so it never slips by a day. */
export function formatDay(stored: string | Date, locale?: string): string {
  return new Date(stored).toLocaleDateString(locale, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
