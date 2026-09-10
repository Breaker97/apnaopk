/**
 * Paging for an availability-first listing.
 *
 * "Out of stock last" is one ordering, but availability is a condition over
 * four fields rather than a field, so no index can sort by it. Instead of
 * asking MongoDB to compute and sort it — a blocking in-memory sort over the
 * whole matching catalogue on every listing — the buyable products are treated
 * as the head of the list and the rest as the tail, and each is fetched with an
 * ordinary indexed `find()`.
 *
 * This works out which slice of each partition one page needs. Pages before the
 * boundary come entirely from the head, the page containing it is split, and
 * pages past it come entirely from the tail — which is exactly what a single
 * availability-first sort would have returned.
 */
type AvailabilityPageSlices = {
  headSkip: number;
  headLimit: number;
  tailSkip: number;
  tailLimit: number;
};

export function splitAvailabilityFirstPage(
  skip: number,
  limit: number,
  availableTotal: number,
): AvailabilityPageSlices {
  // Negative once the page starts past the head; clamped to 0, which also tells
  // the caller to skip that query entirely.
  const headLimit = Math.max(0, Math.min(limit, availableTotal - skip));

  return {
    headSkip: skip,
    headLimit,
    // Where the head ran out, not where this page began.
    tailSkip: Math.max(0, skip - availableTotal),
    tailLimit: limit - headLimit,
  };
}
