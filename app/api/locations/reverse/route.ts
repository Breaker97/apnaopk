import { z } from "zod";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { rateLimitByIP } from "@/lib/api/rate-limit-middleware";
import { reverseGeocode } from "@/lib/intl/geocoding";
import { roundShopperCoordinate } from "@/lib/locations/shopper-location";
import { isUsableLatLng } from "@/lib/locations/vendor-geo";
import { isValidLocale } from "@/config/i18n.config";

/**
 * The point to name, coarsened before it is used for anything.
 *
 * The picker already rounds what the browser gives it, so this is the second
 * pass a hand-edited or shared URL has to survive: a caller cannot ask this
 * endpoint — and through it, Nominatim — about a doorstep.
 */
const Coordinate = z
  // Not `z.coerce.number()`: it reads a missing param as 0, so half a point
  // ("?lat=23.81", no lng) would resolve to a spot in the Atlantic instead of
  // being refused.
  .string()
  .trim()
  .min(1)
  .transform(Number)
  .refine(Number.isFinite);

const PointQuerySchema = z.object({
  lat: Coordinate,
  lng: Coordinate,
});

/**
 * The storefront's locale, forwarded to the geocoder so the place comes back
 * in the language of the page asking. Only known locales pass: the value ends
 * up in an outbound request, and an unrecognised one has no name to fetch.
 */
function requestedLanguage(value: string | null): string | undefined {
  const locale = value?.trim();
  return locale && isValidLocale(locale) ? locale : undefined;
}

/**
 * GET /api/locations/reverse?lat=&lng=&lang=
 *
 * What a coordinate is called, for the header's "Deliver to" line. Public and
 * anonymous: a shopper sets where they are before they have an account.
 *
 * Server-side rather than from the browser so the shopper's coordinate reaches
 * OpenStreetMap from the deployment instead of from their own IP, and so one
 * neighbourhood costs one lookup however many shoppers stand in it.
 *
 * `{ place: null }` is a normal answer — an unnamed point, an outage, or a
 * lookup skipped because the queue was busy. The caller falls back to a generic
 * "Near me" label; the location itself is unaffected either way.
 */
export const GET = withApi({ db: false }, async ({ request }) => {
  await rateLimitByIP(request, "lenient");

  const params = request.nextUrl.searchParams;
  const parsed = PointQuerySchema.safeParse({
    lat: params.get("lat"),
    lng: params.get("lng"),
  });

  if (!parsed.success || !isUsableLatLng(parsed.data.lat, parsed.data.lng)) {
    return successResponse({ place: null });
  }

  const place = await reverseGeocode(
    roundShopperCoordinate(parsed.data.lat),
    roundShopperCoordinate(parsed.data.lng),
    requestedLanguage(params.get("lang")),
  );

  return successResponse({ place });
});
