/**
 * The traffic page's contract with Plausible: what the server loader
 * (`lib/analytics/plausible.ts`) returns and the page renders. Runtime-free
 * (types, constants and pure helpers), so the client component can import it.
 */

import {
  resolveDashboardPeriod,
  toDayString,
  type DashboardPeriodKey,
  type DashboardPeriodSearch,
} from "@/lib/admin/dashboard-period";

export const TRAFFIC_PERIODS = [
  "day",
  "7d",
  "30d",
  "month",
  "6mo",
  "12mo",
  "all",
] as const;

export type TrafficPeriod = (typeof TRAFFIC_PERIODS)[number];

/** The period the proxy route reads when a request names none. */
export const DEFAULT_TRAFFIC_PERIOD: TrafficPeriod = "30d";

/** A named Plausible period, or an inclusive `YYYY-MM-DD` range. */
export type TrafficQuery =
  | { period: TrafficPeriod }
  | { from: string; to: string };

/**
 * The period the page is showing, in the shape the dashboard's period picker
 * takes: the resolved key and its bounds as "YYYY-MM-DD", empty for "all".
 */
export interface TrafficSelection {
  key: string;
  from: string;
  to: string;
}

/** What the Analytics page opens on; the dashboard opens on "today" instead. */
export const DEFAULT_ANALYTICS_PERIOD: DashboardPeriodKey = "month";

/**
 * The page's `?period=` / `?from=&to=`, resolved by the same rules as the
 * admin dashboard, so "last 7 days" means the same on both screens. Only the
 * period a bare URL opens on is the page's own.
 */
export function resolveTrafficSelection(
  search: DashboardPeriodSearch,
  now = new Date(),
): TrafficSelection {
  const { key, range } = resolveDashboardPeriod(
    search,
    now,
    DEFAULT_ANALYTICS_PERIOD,
  );
  return {
    key,
    from: range ? toDayString(range.from) : "",
    to: range ? toDayString(range.to) : "",
  };
}

/** Every span but all time is asked of Plausible as the days it covers. */
export function trafficQueryFor({
  from,
  to,
}: Pick<TrafficSelection, "from" | "to">): TrafficQuery {
  return from && to ? { from, to } : { period: "all" };
}

/** The proxy route's query string for `query`. */
export function trafficQueryParams(query: TrafficQuery): URLSearchParams {
  return "from" in query
    ? new URLSearchParams({ period: "custom", from: query.from, to: query.to })
    : new URLSearchParams({ period: query.period });
}

export interface TrafficAggregate {
  visitors: { value: number };
  pageviews: { value: number };
  bounce_rate: { value: number };
  visit_duration: { value: number };
  visits: { value: number };
}

export interface TrafficPoint {
  date: string;
  visitors: number;
  pageviews: number;
}

/** What one point of a series stands for; Plausible picks the interval itself. */
export type SeriesUnit = "hour" | "day" | "month";

/**
 * The unit of a series, read from the series: Plausible buckets a single day
 * by the hour, a long span by the month and anything between by the day, and
 * which it chose cannot be told from the period alone ("all time" has no
 * fixed length).
 */
export function trafficSeriesUnit(series: TrafficPoint[]): SeriesUnit {
  // An hourly bucket is dated "2026-10-07 14:00:00"; the others are bare days.
  if (series[0] && series[0].date.length > 10) return "hour";
  // A monthly series may open on the range's own start; the rest begin on the 1st.
  const monthly =
    series.length > 2 &&
    series.slice(1).every((point) => point.date.slice(8, 10) === "01");
  return monthly ? "month" : "day";
}

export interface TrafficBreakdownRow {
  page?: string;
  source?: string;
  country?: string;
  browser?: string;
  os?: string;
  device?: string;
  visitors: number;
  pageviews?: number;
}

export type TrafficOverview =
  | { configured: false }
  | {
      configured: true;
      /** Plausible answered none of the requests: unreachable, or it refused the key. */
      unavailable: boolean;
      aggregate: TrafficAggregate | null;
      timeseries: TrafficPoint[];
      pages: TrafficBreakdownRow[];
      sources: TrafficBreakdownRow[];
      countries: TrafficBreakdownRow[];
      browsers: TrafficBreakdownRow[];
      os: TrafficBreakdownRow[];
      devices: TrafficBreakdownRow[];
      realtimeVisitors: number | null;
    };
