/**
 * Rows per page on the Activity Log screens.
 *
 * Not the API's default of 25: the table's page-size menu offers 10, 20, 30, 50
 * and 100, and a size it does not list leaves the menu showing nothing. The
 * endpoints keep their own default; a screen's `limit` is its own choice.
 */
export const ACTIVITY_LOG_PAGE_SIZE = 20;

/** The `limit` a screen's URL asks for, or the screen's own default. */
export function pageSizeFromParams(
  searchParams: Record<string, string | string[] | undefined>,
): number {
  const raw =
    typeof searchParams.limit === "string" ? Number.parseInt(searchParams.limit, 10) : NaN;
  return Number.isInteger(raw) && raw >= 1 && raw <= 100 ? raw : ACTIVITY_LOG_PAGE_SIZE;
}
