/**
 * Calendar months, in UTC, as the one thing anybody closes.
 *
 * UTC throughout, like every other dated figure in finance: a month boundary
 * that moved with the server's timezone would include or exclude a day's
 * takings depending on where the box happens to be.
 *
 * Gathered here because the same three sums were being written in the close
 * API, the panel that calls it and the screen around them — and a month whose
 * last instant differs by a millisecond between two of those is a month whose
 * figures differ between the preview and the snapshot.
 */

/** "2026-07" — the label a closed period is stored and found under. */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** First and last instant of a "YYYY-MM", inclusive. */
export function monthBounds(month: string): { from: Date; to: Date } {
  const [year, monthIndex] = month.split("-").map(Number);
  const from = new Date(Date.UTC(year, monthIndex - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0) - 1);
  return { from, to };
}

/**
 * The finished months a store could still be closing, newest first.
 *
 * Three years rather than one. Twelve months assumed the store had been closing
 * as it went; one that has never closed anything — which is every store until
 * the day it starts — could not reach the year it actually needs to file, and
 * nothing on the screen said why the month was missing.
 */
export function closableMonths(now: Date, count = 36): string[] {
  const months: string[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i < count; i += 1) {
    // Step back first: the current month is not finished, and closing it would
    // date the rest of its own days into the next one.
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    months.push(monthKey(cursor));
  }
  return months;
}

/** "July 2026" — a month said the way a person would say it. */
export function formatMonthLabel(month: string, locale: string): string {
  const { from } = monthBounds(month);
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(from);
}
