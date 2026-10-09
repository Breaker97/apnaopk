import "server-only";

import {
  resolveRequestLocationValues,
  type RequestLocation,
} from "@/lib/locations/shopper-location";

/**
 * The location params a storefront listing page should pass to its product
 * grid, as raw strings. The query layer validates and rounds them for cache
 * keys, so request pages never parse them differently from one another.
 */
export type { RequestLocation } from "@/lib/locations/shopper-location";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Resolve the location a server-rendered listing is filtered by, from its URL.
 *
 * Synchronous, and deliberately blind to the saved place: the shopper's
 * "Deliver to" location says where they want an order to arrive, not which
 * sellers they want to browse. See `resolveRequestLocationValues`.
 */
export function resolveRequestLocation(search: SearchParams): RequestLocation {
  return resolveRequestLocationValues(search);
}
