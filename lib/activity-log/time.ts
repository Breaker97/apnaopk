/**
 * The Time column's two readings of one instant: how long ago, and exactly when.
 *
 * `Intl` does the wording, so it follows the viewer's locale without a message
 * per unit. Pure — `now` is a parameter — so the thresholds are testable.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Past this, "34 days ago" is less useful than the date. */
const RELATIVE_LIMIT_DAYS = 30;

/** "3 minutes ago", "yesterday", or a date once it is a month old. Empty for a bad date. */
export function formatRelativeTime(value: string | Date, now: Date, locale: string): string {
  const then = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(then.getTime())) return "";

  // A row stamped a moment ahead of this browser's clock is "now", not "in 2 seconds".
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (seconds < 45) return relative.format(0, "second");
  if (seconds < HOUR) return relative.format(-Math.max(1, Math.round(seconds / MINUTE)), "minute");
  if (seconds < DAY) return relative.format(-Math.round(seconds / HOUR), "hour");
  const days = Math.round(seconds / DAY);
  if (days < RELATIVE_LIMIT_DAYS) return relative.format(-days, "day");

  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(then);
}

/** "Oct 3, 2026, 2:15:04 PM" in the viewer's locale and timezone. Empty for a bad date. */
export function formatExactTime(value: string | Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(date);
}

/** "Oct 3, 2026, 2:15 PM": the minute is enough for a history list. Empty for a bad date. */
export function formatShortTime(value: string | Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
