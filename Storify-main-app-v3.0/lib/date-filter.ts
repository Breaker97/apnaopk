import {
  DASHBOARD_PERIODS,
  resolveNamedPeriod,
  toDayString,
  type DashboardPeriodKey,
  type DashboardRange,
} from "@/lib/admin/dashboard-period";

/**
 * The value of a list's "date" filter, held in the query string as one param.
 *
 * Either the id of a named period (`today`, `week`, ... — the dashboard's) or
 * an inclusive pair of days, `2026-10-01_2026-10-03`. One param rather than
 * `from` + `to` because a filter change is a single navigation, and two
 * navigations in one handler each start from the same stale query string, so
 * the second would undo the first.
 *
 * Runtime-free, like `dashboard-period`: the list's server query and the
 * toolbar's picker read the same value with the same arithmetic. Days are UTC
 * days, the bucket the dashboard and Finance already use, so "today" here and
 * "today" on the dashboard are the same orders.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Source of the pattern, so a zod schema can reuse it without a regex copy. */
export const DAY_RANGE_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/;

/** A real calendar day: "2026-02-31" would otherwise roll over into March. */
function parseDay(value: string): Date | null {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return toDayString(date) === value ? date : null;
}

/** "2026-08-27" in the viewer's own days, which is what they picked. */
export function localDateToDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** "2026-08-27" as that day's midnight in the viewer's timezone, which the calendar paints. */
export function dayToLocalDate(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

/** The calendar's rendering of a resolved period; "all" has none and reads as today. */
export function toCalendarRange(
  range: DashboardRange | null,
  now: Date,
): { from: Date; to: Date } {
  if (!range) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: today, to: today };
  }
  return {
    from: dayToLocalDate(toDayString(range.from)),
    to: dayToLocalDate(toDayString(range.to)),
  };
}

/** `2026-10-01_2026-10-03` for the days the viewer picked. */
export function encodeDayRange(from: Date, to: Date): string {
  return `${localDateToDay(from)}_${localDateToDay(to)}`;
}

/** The two days of a picked range, or null for anything else (a named period, junk). */
export function parseDayRange(
  value: string | undefined,
): { from: string; to: string } | null {
  if (!value || !DAY_RANGE_PATTERN.test(value)) return null;
  const [from, to] = value.split("_");
  const start = parseDay(from);
  const end = parseDay(to);
  if (!start || !end || start > end) return null;
  return { from, to };
}

/**
 * The time window a filter value stands for, or null for "no filter".
 *
 * Unknown or hand-edited values also read as no filter: a list that ignores a
 * bad param is better than one that errors, or that quietly shows some other
 * period than the URL claims.
 */
export function resolveDateFilter(
  value: string | undefined,
  now = new Date(),
): DashboardRange | null {
  if (!value || value === "all") return null;

  const picked = parseDayRange(value);
  if (picked) {
    const from = parseDay(picked.from)!;
    const to = parseDay(picked.to)!;
    return { from, to: new Date(to.getTime() + DAY_MS - 1) };
  }

  const key = DASHBOARD_PERIODS.find(
    (candidate): candidate is Exclude<DashboardPeriodKey, "all"> =>
      candidate !== "all" && candidate === value,
  );
  return key ? resolveNamedPeriod(key, now) : null;
}
