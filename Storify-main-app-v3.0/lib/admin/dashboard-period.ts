/**
 * The period the admin dashboard's stat cards are reading.
 *
 * Runtime-free so the server loader and the client picker share one definition
 * of "the last 7 days" instead of each doing the arithmetic. Held in the URL
 * (`?period=` or `?from=&to=`) like the Finance screens, so a figure can be
 * linked to and a named span keeps meaning itself tomorrow.
 *
 * Days are UTC days, the same bucket the dashboard's month aggregation and
 * Finance's `parseDayStart` already use.
 */

export const DASHBOARD_PERIODS = [
  "today",
  "yesterday",
  "week",
  "month",
  "all",
] as const;

export type DashboardPeriodKey = (typeof DASHBOARD_PERIODS)[number];

/** English names for the periods, for when a locale has no `…period.<key>` yet. */
export const DASHBOARD_PERIOD_FALLBACK_LABELS: Record<DashboardPeriodKey, string> =
  {
    today: "Today",
    yesterday: "Yesterday",
    week: "Last 7 days",
    month: "This month",
    all: "All time",
  };

export interface DashboardPeriodSearch {
  period?: string;
  from?: string;
  to?: string;
}

/** `from`/`to` are inclusive UTC bounds: 00:00:00.000 and 23:59:59.999. */
export interface DashboardRange {
  from: Date;
  to: Date;
}

export interface ResolvedDashboardPeriod {
  /** A named period, "custom" for picked dates, "all" for the unfiltered view. */
  key: DashboardPeriodKey | "custom";
  /** Null for "all": the cards then keep their all-time / month-on-month shape. */
  range: DashboardRange | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function utcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** The same day at its last instant, so a range ending "today" includes today. */
function utcDayEnd(dayStart: Date): Date {
  return new Date(dayStart.getTime() + DAY_MS - 1);
}

function parseDay(value?: string): Date | null {
  if (!value || !DAY_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2026-08-27", the form the URL and `parseDay` agree on. */
export function toDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Named spans resolved against a clock. `all` has no range. */
export function resolveNamedPeriod(
  key: DashboardPeriodKey,
  now = new Date(),
): DashboardRange | null {
  const today = utcDayStart(now);
  switch (key) {
    case "today":
      return { from: today, to: utcDayEnd(today) };
    case "yesterday": {
      const yesterday = new Date(today.getTime() - DAY_MS);
      return { from: yesterday, to: utcDayEnd(yesterday) };
    }
    case "week":
      // The last 7 days, today included — not the calendar week. A week that
      // starts on Monday is only today on a Monday, so the period read as
      // empty one day in seven, and its trend badge compared it with Sunday.
      return {
        from: new Date(today.getTime() - 6 * DAY_MS),
        to: utcDayEnd(today),
      };
    case "month":
      return {
        from: new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
        ),
        to: utcDayEnd(today),
      };
    default:
      return null;
  }
}

/**
 * The period a bare `/admin/dashboard` opens on. "Today" because the page's
 * first job is "what is happening in the store now" — its heading says so —
 * and the URL stays clean for the view people open most.
 */
export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriodKey = "today";

/**
 * Picked dates win over a named period; an unparsable or reversed pair falls
 * back to the named one (or to `fallback`, the page's own default) rather than
 * erroring, so a hand-edited URL still shows a dashboard.
 */
export function resolveDashboardPeriod(
  search: DashboardPeriodSearch,
  now = new Date(),
  fallback: DashboardPeriodKey = DEFAULT_DASHBOARD_PERIOD,
): ResolvedDashboardPeriod {
  const from = parseDay(search.from);
  const to = parseDay(search.to);
  if (from && to && from <= to) {
    return { key: "custom", range: { from, to: utcDayEnd(to) } };
  }

  const key =
    DASHBOARD_PERIODS.find((candidate) => candidate === search.period) ??
    fallback;
  if (key === "all") return { key, range: null };
  return { key, range: resolveNamedPeriod(key, now) };
}

/**
 * The window of equal length immediately before `range`, which every trend
 * badge is measured against: "today" against yesterday, a picked fortnight
 * against the fortnight before it.
 */
export function previousRange(range: DashboardRange): DashboardRange {
  const length = range.to.getTime() - range.from.getTime() + 1;
  return {
    from: new Date(range.from.getTime() - length),
    to: new Date(range.from.getTime() - 1),
  };
}

/** Inclusive day count of a resolved range. */
export function rangeDays(range: DashboardRange): number {
  return Math.round((range.to.getTime() - range.from.getTime() + 1) / DAY_MS);
}
