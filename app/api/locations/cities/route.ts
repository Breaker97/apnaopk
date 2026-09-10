import { successResponse } from "@/lib/api/response";
import { rateLimitByIP } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";
import {
  MARKETPLACE_CITY_LIMIT,
  filterMarketplaceCities,
  getMarketplaceCities,
} from "@/lib/locations/nearby-vendors";

/**
 * GET /api/locations/cities
 *
 * Cities with sellable products, for the storefront location picker. Public and
 * anonymous — a shopper chooses where they are before they have an account.
 *
 * Only cities whose vendors publish a location appear here; vendors set to
 * `hidden` are excluded upstream, so this never turns the picker into a way to
 * discover an address a seller chose not to publish.
 *
 * `?q=` narrows the list and `?limit=` caps it. Both are optional: without them
 * the picker still gets a sensible first page rather than every city on the
 * marketplace, which on a large one is a payload no popover needs.
 */
export const GET = withApi({}, async ({ request }) => {
  await rateLimitByIP(request, "lenient");

  const params = request.nextUrl.searchParams;
  const query = params.get("q");

  // A junk or oversized `limit` falls back to the default instead of erroring:
  // this endpoint feeds a picker, and a bad query string should still render a
  // usable list.
  const requested = Number(params.get("limit"));
  const limit =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), MARKETPLACE_CITY_LIMIT)
      : MARKETPLACE_CITY_LIMIT;

  const all = await getMarketplaceCities();
  const cities = filterMarketplaceCities(all, query, limit);

  // The unfiltered total lets the picker say how many places it is not showing.
  return successResponse({ cities, total: all.length });
});
