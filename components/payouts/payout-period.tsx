"use client";

import { useLocale } from "next-intl";

/**
 * A payout's dates, as the days they were chosen as.
 *
 * Payout periods are calendar days kept in UTC — the end is 23:59:59 UTC on
 * the last day. Shown in the browser's own zone, a period ending 31 October
 * read as 1 November anywhere east of Greenwich. Only a period chosen to the
 * minute (`timestamp`) is shown in local time.
 */
export function formatPayoutDay(
  value: string | Date,
  locale: string,
  boundary?: string | null,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    ...(boundary === "timestamp" ? {} : { timeZone: "UTC" }),
  }).format(date);
}

export function PayoutPeriod({
  start,
  end,
  boundary,
}: {
  start: string | Date;
  end: string | Date;
  boundary?: string | null;
}) {
  const locale = useLocale();
  return (
    <span className="text-sm text-muted-foreground">
      {formatPayoutDay(start, locale, boundary)} – {formatPayoutDay(end, locale, boundary)}
    </span>
  );
}
