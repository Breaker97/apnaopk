import {
  DASHBOARD_PERIOD_FALLBACK_LABELS,
  resolveDashboardPeriod,
  toDayString,
  type DashboardPeriodKey,
  type DashboardPeriodSearch,
} from "@/lib/admin/dashboard-period";
import { formatPeriodRange } from "@/lib/finance/period-label";
import type { FinancePeriod } from "@/lib/finance/reports";

/**
 * A finance screen's period, read from the dashboard's own URL contract
 * (`?period=today|yesterday|week|month|all` or `?from=&to=`).
 *
 * Finance keeps its own resolver, `resolveRequestedPeriod`, for the screens and
 * exports that still speak `7d`/`30d`/`ytd`. This one lets a screen share the
 * dashboard's picker without learning its arithmetic: the span is the
 * dashboard's, so "last 7 days" means the same days on both, and the ledger
 * query below it is unchanged — it still takes two instants.
 *
 * "All time" has no range on the dashboard (the cards then keep their all-time
 * shape); the ledger needs a start, and the epoch is the one finance has always
 * used for it, so no store's history is cut short.
 */
export function resolveFinanceDashboardPeriod(
  search: DashboardPeriodSearch,
  now = new Date(),
  fallback: DashboardPeriodKey = "month",
): FinancePeriod & { key: string } {
  const { key, range } = resolveDashboardPeriod(search, now, fallback);
  return range
    ? { key, from: range.from, to: range.to }
    : { key, from: new Date(0), to: now };
}

/**
 * The bounds `DashboardPeriodPicker` is given: days, and empty for "all time",
 * where the picker has no dates to draw.
 */
export function dashboardPickerBounds(period: FinancePeriod & { key: string }): {
  from: string;
  to: string;
} {
  return period.key === "all"
    ? { from: "", to: "" }
    : { from: toDayString(period.from), to: toDayString(period.to) };
}

/**
 * What a screen calls the period it is showing.
 *
 * A named period says its name, in the dashboard's wording; a picked one has to
 * spell out its dates, because "custom" tells a reader nothing about which days
 * they are seeing.
 */
export function financePeriodLabel(
  period: FinancePeriod & { key: string },
  locale: string,
  label: (key: string, fallback: string) => string,
): string {
  if (period.key === "custom") return formatPeriodRange(period, locale);
  return label(
    `admin.dashboardPage.period.${period.key}`,
    DASHBOARD_PERIOD_FALLBACK_LABELS[period.key as DashboardPeriodKey] ??
      period.key,
  );
}
