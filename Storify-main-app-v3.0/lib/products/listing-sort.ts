import { normalizeRequestSortBy } from "@/lib/locations/shopper-location";

/** A listing page's search params, as a server component receives them. */
type ListingSearchParams = Record<string, string | string[] | undefined>;

/**
 * The order a product listing runs when the shopper has not picked one.
 *
 * A search is ordered by how well each product matches — "Best match" — and
 * a plain listing by popularity. The two used to share "popular", which
 * meant a search results page ranked a product that matched one word of the
 * query above an exact name match whenever the first had more reviews.
 */
export function defaultListingSort(searching: boolean): "relevance" | "popular" {
  return searching ? "relevance" : "popular";
}

/**
 * The order a listing page runs: the URL's, or the default for what the
 * page is showing. "relevance" means nothing without a search, so a link
 * that kept `sortBy=relevance` after its search was cleared falls back to
 * the browsing default rather than to an order the control cannot show.
 */
export function resolveListingSort(search: ListingSearchParams): string {
  const searching =
    typeof search.search === "string" && search.search.trim() !== "";
  const requested = normalizeRequestSortBy(
    typeof search.sortBy === "string" ? search.sortBy : undefined,
    search,
  );
  if (!requested || (requested === "relevance" && !searching)) {
    return defaultListingSort(searching);
  }
  return requested;
}
