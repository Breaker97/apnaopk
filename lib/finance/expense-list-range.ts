import {
  DASHBOARD_PERIODS,
  resolveNamedPeriod,
} from "@/lib/admin/dashboard-period";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instants an expense list asks its API for, given the dashboard's period.
 *
 * An expense's date is stored as midnight UTC of the day somebody picked, so the
 * list has to compare days, not moments. The named periods are therefore
 * resolved from `today` — the viewer's own calendar day — rather than from the
 * server's clock: east of Greenwich the server's "today" is still yesterday for
 * the first hours of the viewer's day, which left a cost recorded for today out
 * of the very list it was recorded in.
 *
 * A picked range is already two whole days, so its bounds are used as they are.
 * "All time" — and any key that is not a period — has no bounds at all, which is
 * what the API reads as every expense.
 */
export function expenseListRange(
  period: string,
  from: string,
  to: string,
  today: string,
): { from: string; to: string } | null {
  if (period === "custom") {
    if (!from || !to) return null;
    return {
      from: new Date(`${from}T00:00:00.000Z`).toISOString(),
      to: new Date(
        new Date(`${to}T00:00:00.000Z`).getTime() + DAY_MS - 1,
      ).toISOString(),
    };
  }

  const key = DASHBOARD_PERIODS.find((candidate) => candidate === period);
  if (!key) return null;
  const range = resolveNamedPeriod(key, new Date(`${today}T00:00:00.000Z`));
  return range
    ? { from: range.from.toISOString(), to: range.to.toISOString() }
    : null;
}
