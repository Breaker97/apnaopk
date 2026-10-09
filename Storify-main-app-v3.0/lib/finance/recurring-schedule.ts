/**
 * When a repeating expense falls due — the calendar arithmetic, and nothing
 * else.
 *
 * Kept free of models so the Record expense form can show the same dates the
 * daily job will use: the next copy, and the copies already owed by a template
 * dated in the past. Two copies of this logic would eventually disagree about
 * the 31st.
 */

export type RecurringInterval = "weekly" | "monthly" | "quarterly" | "yearly";

interface RecurringSchedule {
  interval?: RecurringInterval | null;
  /** The next date a copy should be created for; null before the first. */
  nextDueAt?: Date | string | null;
  /** No copy is created for a date after this one. */
  endsAt?: Date | string | null;
}

const toDate = (value: Date | string | null | undefined): Date | null =>
  value ? new Date(value) : null;

/**
 * The next occurrence after `from`. Months step by calendar, not by 30 days.
 *
 * `anchorDay` is the day of the month the template was set up on, and it has to
 * be passed along the whole chain rather than read off the previous occurrence.
 * Rent due on the 31st falls to the 28th in February — that part is unavoidable
 * — but if the next step then measures from the 28th, the 31st is gone for
 * good and the template quietly pays on the 28th for the rest of its life. The
 * anchor is what lets it climb back to the 31st in March.
 */
export function nextOccurrence(
  from: Date,
  interval: RecurringInterval,
  anchorDay = from.getUTCDate(),
): Date {
  if (interval === "weekly") {
    // A week is always seven days; no month-end reasoning applies.
    const next = new Date(from);
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  const months = interval === "quarterly" ? 3 : interval === "yearly" ? 12 : 1;
  return addMonths(from, months, anchorDay);
}

/**
 * `from` plus `months`, landing on `anchorDay` or the last day of that month.
 *
 * Built from the target month rather than by nudging the date, because
 * `setUTCMonth` overflows: 31 January plus a month is 3 March, since February
 * has no 31st. Asking the target month how many days it has and taking the
 * smaller of the two is what a calendar means by "monthly".
 */
function addMonths(from: Date, months: number, anchorDay: number): Date {
  const target = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth() + months,
      1,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(anchorDay, lastDay));
  return target;
}

/** A template that has never run is due one interval after its own date. */
export function dueDateFor(template: {
  date: Date;
  recurring?: RecurringSchedule | null;
}): Date {
  const interval = template.recurring?.interval ?? "monthly";
  return (
    toDate(template.recurring?.nextDueAt) ??
    nextOccurrence(template.date, interval)
  );
}

/**
 * The first due date on or after `day`, stepping from the template's own date.
 *
 * Where a schedule resumes when the past is NOT filled in: a template switched
 * on months after its date, or turned back on after a pause, starts owing from
 * today rather than from whenever it last ran. A copy due today still counts.
 */
export function firstOccurrenceOnOrAfter(
  templateDate: Date,
  interval: RecurringInterval,
  day: Date,
): Date {
  const anchorDay = templateDate.getUTCDate();
  let due = nextOccurrence(templateDate, interval, anchorDay);
  // Bounded: a weekly template from the epoch is still only a few thousand
  // steps, and nothing may loop forever on a bad date.
  for (let step = 0; due < day && step < 20_000; step += 1) {
    due = nextOccurrence(due, interval, anchorDay);
  }
  return due;
}

/**
 * The dates a template already owes: from its next due date up to, but not
 * including, `before`. What switching it on "with the past filled in" would
 * create, and what switching it on without would skip.
 */
export function pastDueOccurrences(
  template: { date: Date; recurring?: RecurringSchedule | null },
  before: Date,
  cap = 500,
): Date[] {
  const interval = template.recurring?.interval ?? "monthly";
  const anchorDay = template.date.getUTCDate();
  const endsAt = toDate(template.recurring?.endsAt);
  const owed: Date[] = [];
  let due = dueDateFor(template);
  while (due < before && (!endsAt || due <= endsAt) && owed.length < cap) {
    owed.push(due);
    due = nextOccurrence(due, interval, anchorDay);
  }
  return owed;
}

/** Midnight UTC of the day `date` falls on — how a date-only field is stored. */
export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}
