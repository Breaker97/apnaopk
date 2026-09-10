import type { FinancePeriod } from "@/lib/finance/reports";

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
  const formatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${formatter.format(period.from)} – ${formatter.format(period.to)}`;
}
