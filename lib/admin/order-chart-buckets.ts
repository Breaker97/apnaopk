import type { DashboardRange } from "@/lib/admin/dashboard-period";
import type {
  OrderChartBucket,
  OrderChartGranularity,
  OrderChartSeries,
} from "@/lib/admin/dashboard-types";

/**
 * Time buckets for the admin orders chart, which follows the dashboard's one
 * period filter. Runtime-free and UTC throughout, like the rest of the
 * dashboard's day and month boundaries.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The bar size that keeps a range readable: about 2–60 bars. Derived rather
 * than offered as a control, because a range has exactly one sensible answer
 * and a second control beside the period picker is one more thing to misread.
 */
export function granularityForRange(range: DashboardRange): OrderChartGranularity {
  const days = Math.round((range.to.getTime() - range.from.getTime() + 1) / DAY_MS);
  if (days <= 2) return "hour";
  if (days <= 62) return "day";
  if (days <= 186) return "week";
  return "month";
}

/** The unit Mongo groups by. Weeks are folded from days here, which keeps the query portable. */
export function queryUnitFor(
  granularity: OrderChartGranularity,
): "hour" | "day" | "month" {
  if (granularity === "hour") return "hour";
  if (granularity === "day" || granularity === "week") return "day";
  return "month";
}

/** `$dateToString` formats for each query unit, and how to read their keys back. */
export const BUCKET_KEY_FORMAT = {
  hour: "%Y-%m-%dT%H",
  day: "%Y-%m-%d",
  month: "%Y-%m",
} as const;

export function parseBucketKey(
  key: string,
  unit: keyof typeof BUCKET_KEY_FORMAT,
): Date {
  if (unit === "hour") return new Date(`${key}:00:00.000Z`);
  if (unit === "day") return new Date(`${key}T00:00:00.000Z`);
  return new Date(`${key}-01T00:00:00.000Z`);
}

export function bucketStart(date: Date, granularity: OrderChartGranularity): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  switch (granularity) {
    case "hour":
      return new Date(Date.UTC(y, m, d, date.getUTCHours()));
    case "day":
      return new Date(Date.UTC(y, m, d));
    case "week": {
      // Monday start, matching the calendar's `weekStartsOn={1}`.
      const day = new Date(Date.UTC(y, m, d));
      return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
    }
    case "month":
      return new Date(Date.UTC(y, m, 1));
    default:
      return new Date(Date.UTC(y, 0, 1));
  }
}

function nextBucket(start: Date, granularity: OrderChartGranularity): Date {
  switch (granularity) {
    case "hour":
      return new Date(start.getTime() + HOUR_MS);
    case "day":
      return new Date(start.getTime() + DAY_MS);
    case "week":
      return new Date(start.getTime() + 7 * DAY_MS);
    case "month":
      return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    default:
      return new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1));
  }
}

/** One time slot of one channel, at any resolution finer than or equal to `granularity`. */
export interface ChartSourceRow {
  start: Date;
  pos: boolean;
  orders: number;
  sales: number;
}

/**
 * Every bucket from `range.from` to `range.to`, empty ones included as zeros so
 * the axis never skips a quiet day, with each source row folded into the
 * bucket it falls in. Rows outside the range are dropped.
 */
export function buildChartSeries(
  rows: Iterable<ChartSourceRow>,
  range: DashboardRange,
  granularity: OrderChartGranularity,
): OrderChartSeries {
  const points: OrderChartBucket[] = [];
  const byStart = new Map<number, OrderChartBucket>();

  for (
    let cursor = bucketStart(range.from, granularity);
    cursor <= range.to;
    cursor = nextBucket(cursor, granularity)
  ) {
    const point: OrderChartBucket = {
      start: cursor.toISOString(),
      inStoreOrders: 0,
      onlineOrders: 0,
      inStoreSales: 0,
      onlineSales: 0,
    };
    points.push(point);
    byStart.set(cursor.getTime(), point);
  }

  for (const row of rows) {
    if (row.start < range.from || row.start > range.to) continue;
    const point = byStart.get(bucketStart(row.start, granularity).getTime());
    if (!point) continue;
    if (row.pos) {
      point.inStoreOrders += row.orders;
      point.inStoreSales += row.sales;
    } else {
      point.onlineOrders += row.orders;
      point.onlineSales += row.sales;
    }
  }

  return {
    granularity,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    points,
  };
}

/** The unfiltered chart never shows less than a year, so a new store still gets an axis. */
const MIN_ALL_TIME_MONTHS = 12;
/** Past this, "All time" is drawn by year: 37+ monthly bars stop being readable. */
const MAX_MONTHLY_BARS = 36;

/**
 * The "All time" chart: every month since the first order, or since a year ago
 * when that is later, folded from rows already grouped by month. Shared by the
 * admin and vendor dashboards so both draw the unfiltered period the same way.
 */
export function buildAllTimeChartSeries(
  rows: readonly ChartSourceRow[],
  now: Date,
): OrderChartSeries {
  let from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MIN_ALL_TIME_MONTHS - 1), 1),
  );
  for (const row of rows) if (row.start < from) from = row.start;

  const months =
    (now.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - from.getUTCMonth()) +
    1;

  return buildChartSeries(
    rows,
    { from, to: now },
    months > MAX_MONTHLY_BARS ? "year" : "month",
  );
}
