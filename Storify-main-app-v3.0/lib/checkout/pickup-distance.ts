/**
 * How far each collection point is from the shopper, and which one to offer
 * first.
 *
 * Client-safe on purpose: the checkout picks a default branch from the same
 * rule the availability endpoint ranks by, and keeping both in one module
 * without a database import is what lets the rule be tested as a plain
 * function and shared across the boundary.
 */

import { distanceKm, type LatLng } from "@/lib/locations/vendor-geo";

/**
 * Decimal places kept on a published branch distance. Product cards round to
 * whole kilometres when they print one, so a tenth is already finer than
 * anything the shopper sees — and coarse enough that a distance from a 1.1 km
 * shopper grid cannot be walked back to a doorstep.
 */
const DISTANCE_DECIMALS = 1;

function roundDistance(value: number): number {
  const factor = 10 ** DISTANCE_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * Attach `distanceKm` to every branch with a known point and order the list
 * nearest-first.
 *
 * Branches without a point keep their relative order and go last: a merchant
 * who has not placed a pin has not said where the branch is, and inventing a
 * position for it would rank it against the ones that did.
 *
 * With no origin the list comes back untouched — a city-only location names an
 * area, not a point to measure from.
 */
export function rankPickupLocationsByDistance<
  T extends { id: string; point?: LatLng },
>(
  locations: readonly T[],
  origin: LatLng | null,
): Array<T & { distanceKm?: number }> {
  if (!origin) return [...locations];

  return locations
    .map((location, index) => ({
      index,
      location:
        location.point === undefined
          ? location
          : { ...location, distanceKm: roundDistance(distanceKm(origin, location.point)) },
    }))
    .sort((a, b) => {
      const da = (a.location as { distanceKm?: number }).distanceKm;
      const db = (b.location as { distanceKm?: number }).distanceKm;
      if (da === undefined && db === undefined) return a.index - b.index;
      if (da === undefined) return 1;
      if (db === undefined) return -1;
      return da - db || a.index - b.index;
    })
    .map((entry) => entry.location);
}

type RankedPickupLocation = {
  id: string;
  /** Absent on a response from before branch stock was checked; read as able. */
  available?: boolean;
  distanceKm?: number;
};

const isUsable = (location: RankedPickupLocation) => location.available !== false;

/**
 * The branch checkout should start on.
 *
 * - A branch the shopper already chose stays chosen while it can still hand
 *   over the whole basket.
 * - Otherwise, the nearest usable branch when distances are known — the
 *   shopper said where they are, so the closest counter is the obvious default,
 *   the way every "collect in store" checkout preselects the nearest shop.
 * - Otherwise, a lone usable branch needs no click; several without distances
 *   leave the choice to the shopper rather than guessing.
 */
export function resolveInitialPickupLocationId(
  locations: readonly RankedPickupLocation[],
  current: string | null,
): string | null {
  const usable = locations.filter(isUsable);
  if (current && usable.some((location) => location.id === current)) {
    return current;
  }

  const nearest = usable
    .filter((location) => typeof location.distanceKm === "number")
    .sort((a, b) => (a.distanceKm as number) - (b.distanceKm as number))[0];
  if (nearest) return nearest.id;

  return usable.length === 1 ? usable[0].id : null;
}
