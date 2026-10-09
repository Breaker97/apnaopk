import type { HomeCollectionTrend, Money } from "@/contracts/mobile/biz/v1";
import { toDayString, type DashboardRange } from "@/lib/admin/dashboard-period";

const DAY_MS = 86_400_000;

/** Exactly seven UTC days, including today's full range, across month/year edges. */
export function collectionTrendRanges(today: DashboardRange): DashboardRange[] {
  return Array.from({ length: 7 }, (_, index) => {
    const from = new Date(today.from.getTime() - (6 - index) * DAY_MS);
    return { from, to: new Date(from.getTime() + DAY_MS - 1) };
  });
}

/** Money and chart scale are computed together on the server, never on the phone. */
export function buildCollectionTrend(
  ranges: readonly DashboardRange[],
  amounts: readonly number[],
  formatMoney: (amount: number) => Money,
): HomeCollectionTrend {
  const values = ranges.map((_, index) => formatMoney(amounts[index] ?? 0));
  const maximum = Math.max(0, ...values.map((value) => value.amount));
  return {
    points: ranges.map((range, index) => ({
      day: toDayString(range.from),
      money: values[index],
      fraction: maximum > 0 ? Math.max(0, values[index].amount / maximum) : 0,
    })),
    maximum: formatMoney(maximum),
    baseline: formatMoney(0),
  };
}
