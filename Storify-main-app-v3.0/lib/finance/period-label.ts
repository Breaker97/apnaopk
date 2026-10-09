import type { FinancePeriod } from "@/lib/finance/reports";

/**
 * A picked period's days, read in UTC — the zone `resolveRequestedPeriod`
 * builds them in. Read in the server's own zone, a period ending on the 27th at
 * 23:59 UTC printed as ending on the 28th on any server east of Greenwich.
 */
function dayFormatter(locale: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "12 Jul 2026 – 27 Aug 2026", in the reader's locale.
 *
 * Only for a period someone picked. A named one — "last 30 days" — says its
 * name instead: printing its dates would turn a span that stays true tomorrow
 * into one that looks fixed, and "All time" would open in 1970.
 */
export function formatPeriodRange(
  period: FinancePeriod,
  locale: string,
): string {
  const formatter = dayFormatter(locale);
  return `${formatter.format(period.from)} – ${formatter.format(period.to)}`;
}

/** "27 Aug 2026" — the last day of a picked period. */
export function formatPeriodEnd(period: FinancePeriod, locale: string): string {
  return dayFormatter(locale).format(period.to);
}

/**
 * The day balances are read at, when that is not today: a picked period that
 * has already ended. Null for a named period, which always runs to now, and
 * for a picked one still running.
 */
export function formatBalancesAsOf(
  period: FinancePeriod & { key: string },
  locale: string,
  now: Date = new Date(),
): string | null {
  if (period.key !== "custom" || period.to.getTime() >= now.getTime()) {
    return null;
  }
  return formatPeriodEnd(period, locale);
}
