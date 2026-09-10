/**
 * UTC calendar-day arithmetic for boost bookings. A boost day runs
 * 00:00:00.000Z to the next 00:00:00.000Z.
 *
 * UTC, not the store timezone: `settings.general.timezone` is an unvalidated
 * free-text input read by nothing that matters, and anchoring money-bearing
 * day boundaries on it would let a typo ("EST") corrupt a booking key. UTC also
 * keeps boost day buckets and `BoostMetricDaily.date` on one axis, so delivery
 * stays auditable per day.
 *
 * This is the only day module — do not add a second one.
 */

export const BOOST_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BOOST_DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC calendar day `date` falls in, as "YYYY-MM-DD". */
export function utcDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** First instant of `day`. */
export function dayStartUtc(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** First instant AFTER `day` — the exclusive end of the range. */
export function dayEndExclusiveUtc(day: string): Date {
  return new Date(dayStartUtc(day).getTime() + BOOST_DAY_MS);
}

/** `day` shifted by `n` days; `n` may be negative. */
export function addDays(day: string, n: number): string {
  return utcDay(new Date(dayStartUtc(day).getTime() + n * BOOST_DAY_MS));
}

/**
 * Round-trips through Date, so "2026-02-30" is rejected rather than silently
 * rolling forward into March.
 */
export function isValidDay(day: unknown): day is string {
  if (typeof day !== "string" || !BOOST_DAY_PATTERN.test(day)) return false;
  const parsed = dayStartUtc(day);
  return !Number.isNaN(parsed.getTime()) && utcDay(parsed) === day;
}

/** Inclusive day count: a single-day range is 1, not 0. */
export function daysBetweenInclusive(from: string, to: string): number {
  return (
    Math.round(
      (dayStartUtc(to).getTime() - dayStartUtc(from).getTime()) / BOOST_DAY_MS,
    ) + 1
  );
}

/**
 * Every day from `from` to `to`, inclusive.
 *
 * The `d <= to` string comparison is safe because "YYYY-MM-DD" is
 * lexicographically ordered — the same property that lets `{ $gte, $lte }`
 * range queries run directly against the stored strings.
 */
export function enumerateDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------------------------------------------------------------------------
// Calendar-widget bridge
//
// react-day-picker hands back Dates at the VIEWER'S local midnight, so
// `utcDay(picked)` is wrong by a day for anyone east of UTC: a vendor in UTC+13
// clicking the cell labelled 12 Sep produces 2026-09-11T11:00Z, and would be
// billed for a day they did not choose. The mapping that IS correct reads the
// calendar fields the vendor actually saw and treats those as the UTC day.
// ---------------------------------------------------------------------------

/** The UTC day for the calendar cell a viewer clicked, regardless of timezone. */
export function utcDayFromCalendarDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

/** The inverse: a local-midnight Date whose calendar fields read as `day`. */
export function calendarDateFromUtcDay(day: string): Date {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  return new Date(year, month - 1, dayOfMonth);
}
