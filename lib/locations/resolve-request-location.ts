import "server-only";

import { cookies } from "next/headers";
import {
  LOCATION_COOKIE,
  parseLocationCookie,
  resolveRequestLocationValues,
  type RequestLocation,
  type ShopperLocation,
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

/**
 * The shopper's saved delivery place, parsed from its cookie. The header's
 * "Deliver to" control is seeded with this so it paints the right place
 * instead of flashing "Set location" on every first render.
 */
export async function readStoredShopperLocation(): Promise<ShopperLocation | null> {
  return parseLocationCookie((await cookies()).get(LOCATION_COOKIE)?.value);
}
