import "server-only";

/**
 * The branches a vendor's orders can be collected from.
 *
 * A pickup branch is an `InventoryLocation` with `pickupEnabled` set — the same
 * record the POS sells from and the same one stock is counted against. It used
 * to be a separate list embedded on the vendor document, which described the
 * same physical address twice: the two copies drifted, and neither knew about
 * the other, so "collect it from where the stock actually is" could not be
 * expressed at all.
 */

import { InventoryLocation } from "@/models/inventory-location.model";
import type { PickupHoursSettings } from "@/lib/checkout/pickup-hours";
import { latLngFromGeoPoint, type LatLng } from "@/lib/locations/vendor-geo";

export type PickupLocationSettings = PickupHoursSettings & {
  id: string;
  name: string;
  /**
   * Where the branch is, when the merchant placed it. Server-side only: the
   * availability endpoint publishes a distance derived from it, never the
   * point itself — `pickupAvailabilityLocationDetails` picks its fields by
   * name, so this cannot ride along by accident.
   */
  point?: LatLng;
};

type LocationRow = {
  _id: unknown;
  name?: string;
  address?: string;
  pickupArea?: string;
  instructions?: string;
  weeklyHours?: Array<{
    weekday: number;
    enabled: boolean;
    start: string;
    end: string;
  }>;
  geo?: unknown;
};

/** The shape the checkout and availability paths read a branch through. */
function toPickupSettings(row: LocationRow): PickupLocationSettings {
  return {
    id: String(row._id),
    name: (row.name || "").trim(),
    enabled: true,
    // A location's own address IS the pickup address — there is only one place.
    pickupAddress: (row.address || "").trim(),
    pickupArea: row.pickupArea?.trim() || undefined,
    instructions: row.instructions?.trim() || undefined,
    weeklyHours: row.weeklyHours || [],
    point: latLngFromGeoPoint(row.geo),
  };
}

/**
 * A vendor's collectable branches, ready for checkout.
 *
 * Only active, pickup-enabled locations that actually have an address: a branch
 * with nowhere to go is not somewhere a shopper can be sent, and offering it
 * would put an empty address on their order.
 */
export async function pickupLocationsForVendor(input: {
  vendorId: string;
}): Promise<PickupLocationSettings[]> {
  const rows = await InventoryLocation.find({
    vendorId: input.vendorId,
    pickupEnabled: true,
    isActive: { $ne: false },
  })
    .select("_id name address pickupArea instructions weeklyHours geo")
    .sort({ isDefault: -1, name: 1 })
    .lean<LocationRow[]>();

  return rows
    .map(toPickupSettings)
    .filter((location) => location.name && location.pickupAddress);
}
