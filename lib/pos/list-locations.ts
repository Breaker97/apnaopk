import "server-only";

import { InventoryLocation } from "@/models/inventory-location.model";
import {
  locationOwnerFilter,
  resolveLocationScope,
} from "@/lib/inventory/inventory-location-scope";

/**
 * A counter the cashier standing at this register may sell from.
 *
 * Deliberately not the whole `InventoryLocation` document: the register only
 * needs enough to tell two branches apart in a list, and everything sent here
 * crosses the RSC boundary into a client component. Opening hours, map links
 * and pickup instructions are checkout concerns and stay behind.
 */
export interface POSLocationOption {
  id: string;
  name: string;
  /**
   * The line under the name. `pickupArea` is the merchant's own short label for
   * the neighbourhood and reads better than a full postal address, so it wins
   * where it exists; the street address is the fallback.
   */
  area: string;
  isDefault: boolean;
}

type POSLocationUser = {
  id: string;
  role?: string | null;
  roles?: (string | null | undefined)[] | null;
};

type LocationRow = {
  _id: unknown;
  name?: string;
  address?: string;
  pickupArea?: string;
  isDefault?: boolean;
};

/**
 * Every counter this caller may stand at, in the order the picker shows them.
 *
 * Scoping is `locationOwnerFilter`'s job and nothing here second-guesses it: a
 * vendor sees their own places, an admin the house store's, and staff only what
 * they are assigned to — which is what makes a one-location staff member skip
 * the picker entirely rather than being offered a choice they do not have.
 *
 * **Only active locations that sell over a counter.** Unlike the settings
 * dropdown, which passes `includeInactive=true` so a merchant can re-enable a
 * branch they closed, a register must never offer one: selling from a
 * deactivated counter is the thing deactivating it was meant to stop. And a
 * warehouse or a collection point is a location with no till — offering it
 * asks a cashier to say they are standing somewhere nobody stands.
 *
 * Returns an empty list rather than throwing. `resolveLocationScope` raises for
 * a store with no default vendor profile yet, and a register that has always
 * worked without locations must keep working — it simply sells from the shared
 * pool, exactly as it did before this file existed.
 */
export async function listPOSLocations(
  user: POSLocationUser,
): Promise<POSLocationOption[]> {
  try {
    // `"write"` for the same reason `resolvePOSLocationId` uses it: standing at
    // a register is taking money, not browsing a list.
    const scope = await resolveLocationScope(user, "write");

    const rows = await InventoryLocation.find(
      // `$ne: false` and not `true`: rows written before the field existed carry
      // nothing, and a register that worked yesterday must not lose every
      // counter waiting on a migration. `sellsAtCounter()` states the same rule
      // for callers holding a loaded row.
      locationOwnerFilter(scope, {
        isActive: true,
        sellsAtCounter: { $ne: false },
      }),
    )
      .select("_id name address pickupArea isDefault")
      // Same order as `GET /api/admin/locations`, so the branch a merchant sees
      // first in settings is the one they see first at the counter.
      .sort({ isDefault: -1, name: 1 })
      .lean<LocationRow[]>();

    return rows.map((row) => ({
      id: String(row._id),
      name: row.name ?? "Location",
      area: (row.pickupArea || row.address || "").trim(),
      isDefault: Boolean(row.isDefault),
    }));
  } catch {
    return [];
  }
}
