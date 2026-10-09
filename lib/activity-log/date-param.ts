import { parseDayRange } from "@/lib/date-filter";

/**
 * The Activity Log's `date` param and the date filter's value are not the same
 * word, and this is the translation between them.
 *
 * Orders reads a bare list as "all time", so its picker's "All time" preset is
 * the filter's `all` and clearing the param is clearing the filter. Here a bare
 * list is the last 30 days — every query is bounded — and `date=all` is the one
 * way to ask for everything. So the toolbar is given:
 *
 * - `last30` for a bare list (the default, which the Filters menu does not count
 *   as an active filter), and
 * - `everything` for `date=all`.
 *
 * Runtime-free, like `lib/date-filter.ts`.
 */

/** The filter value of the default window: no `date` in the URL. */
export const LAST_30_DAYS = "last30";

/** The filter value of `date=all`: no window at all. */
export const ALL_TIME = "everything";

/** The dashboard's named periods the toolbar offers, less its "All time". */
export const NAMED_PERIODS = ["today", "yesterday", "week", "month"] as const;

/**
 * What the toolbar shows for the URL's `date`. A value the server would ignore
 * (a hand-edited one) shows as the default, because that is what the list is
 * showing.
 */
export function dateParamToFilterValue(param: string | null | undefined): string {
  if (param === "all") return ALL_TIME;
  if (!param) return LAST_30_DAYS;
  if ((NAMED_PERIODS as readonly string[]).includes(param)) return param;
  return parseDayRange(param) ? param : LAST_30_DAYS;
}

/**
 * The `date` the URL should carry for a toolbar choice, or undefined to remove
 * it. The toolbar's own "clear" is `all`, and here that means the default.
 */
export function filterValueToDateParam(value: string): string | undefined {
  if (value === ALL_TIME) return "all";
  if (value === LAST_30_DAYS || value === "all" || value === "") return undefined;
  return value;
}
