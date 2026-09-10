import { z } from "zod";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import {
  pickupAvailabilityLocationDetails,
  pickupAvailabilityVendorDetails,
  pickupLocationAvailability,
  resolvePickupEligibility,
} from "@/lib/checkout/checkout-pickup";
import { rankPickupLocationsByDistance } from "@/lib/checkout/pickup-distance";
import { pickupOpeningHoursSummary } from "@/lib/checkout/pickup-hours";
import { roundShopperCoordinate } from "@/lib/locations/shopper-location";
import { isUsableLatLng, type LatLng } from "@/lib/locations/vendor-geo";

/**
 * The shopper's own point, from `?lat=&lng=`, or `null` when absent or junk.
 *
 * Tolerant on purpose: the origin only ranks the branches, so a malformed
 * value degrades to an unranked list rather than refusing the whole answer.
 * Coarsened to the same ~1.1 km grid the picker writes, so a hand-edited URL
 * cannot make this endpoint measure from a doorstep.
 */
const OriginQuerySchema = z.object({
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
});

function shopperOrigin(searchParams: URLSearchParams): LatLng | null {
  const parsed = OriginQuerySchema.safeParse({
    lat: searchParams.get("lat") ?? undefined,
    lng: searchParams.get("lng") ?? undefined,
  });
  if (!parsed.success) return null;

  const { lat, lng } = parsed.data;
  if (!isUsableLatLng(lat, lng)) return null;
  return {
    lat: roundShopperCoordinate(lat as number),
    lng: roundShopperCoordinate(lng as number),
  };
}

/**
 * The branches the caller's current cart can be collected from.
 *
 * Server-derived, and only ever for the caller's own cart — a shopper cannot
 * ask about somebody else's. The response carries no exact address and no
 * instructions: this endpoint is anonymous, so anything it returns is readable
 * by anyone who can put an item in a cart.
 *
 * With `?lat=&lng=` — the location the shopper set in the header — each branch
 * that has a pin also carries `distanceKm`, and the list comes back nearest
 * first, so checkout can start on the closest counter. The distance is a
 * tenth of a kilometre from a coarse origin; the pin itself never leaves the
 * server.
 */
export const GET = withApi(
  { auth: "optional", rateLimit: { action: "checkout:pickup-availability", preset: "lenient" } },
  async ({ request, session }) => {
    const sessionId = request.cookies.get("cart_session")?.value;
    const eligibility = await resolvePickupEligibility({
      userId: session?.user?.id,
      sessionId,
    });
    if (!eligibility.eligible) return successResponse(eligibility);

    const ranked = rankPickupLocationsByDistance(
      pickupLocationAvailability(eligibility),
      shopperOrigin(request.nextUrl.searchParams),
    );

    return successResponse({
      eligible: true,
      vendor: pickupAvailabilityVendorDetails({
        vendorId: eligibility.vendorId,
        vendorName: eligibility.vendorName,
      }),
      locations: ranked.map((location) => ({
        ...pickupAvailabilityLocationDetails(location),
        openingHours: pickupOpeningHoursSummary(location),
        // Whether this branch holds the whole basket. A boolean and nothing
        // more: which items are short is a stock level, and this endpoint is
        // anonymous — anyone who can put something in a cart could otherwise
        // read a competitor's per-branch counts one probe at a time.
        available: location.available,
        ...(location.distanceKm === undefined
          ? {}
          : { distanceKm: location.distanceKm }),
        // Kept for one release. A checkout tab loaded before this deploy runs
        // the previous bundle, whose submit guard reads a missing `scheduling`
        // as "this branch still owes a booked time" and would leave its Pay
        // button disabled forever. The current client ignores the key.
        scheduling: "open_hours",
      })),
    });
  },
);
