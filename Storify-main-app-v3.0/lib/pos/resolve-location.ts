import "server-only";

import { InventoryLocation } from "@/models/inventory-location.model";
import {
  locationOwnerFilter,
  resolveLocationScope,
} from "@/lib/inventory/inventory-location-scope";

type POSLocationUser = {
  id: string;
  role?: string | null;
  roles?: (string | null | undefined)[] | null;
};

/**
 * Which location this register is standing at.
 *
 * `settings.pos.defaultPosLocationId` is a single platform-wide field, but
 * locations are **per vendor** (see `models/inventory-location.model.ts`). Handed
 * straight to every terminal, it named the house store's counter on a vendor's
 * register — an id no product of theirs can ever carry a row for, so the whole
 * catalogue read 0 and the register was permanently "out of stock". The same id
 * then reached `decrementInventory` as a hard scope, so even an oversellable
 * line failed at the point of sale.
 *
 * So the configured id is only ever used by a terminal that **owns** it. A
 * merchant who doesn't stands at their own default location instead, and one
 * with no default stands nowhere — which reads as the plain aggregate stock,
 * the behaviour every register had before a location was configured at all.
 *
 * The platform setting stays the switch: with it unset no terminal is
 * location-scoped, exactly as today. Setting it is what says "registers sell
 * from a counter", and each merchant's own counter is the honest reading of
 * that for their register.
 */
export async function resolvePOSLocationId(
  user: POSLocationUser,
  configuredLocationId: string | undefined,
): Promise<string> {
  const configured = String(configuredLocationId ?? "").trim();
  if (!configured) return "";

  // `"write"` for the same reason the product list uses it: running a register
  // is taking money, not browsing.
  const scope = await resolveLocationScope(user, "write");

  // One query, then match in memory — `locationOwnerFilter` overwrites `_id`
  // with the staff location restriction, so asking it for a specific id would
  // silently answer about a different location for scoped staff.
  //
  // Scoped to places a register may stand at, so this agrees with the list the
  // picker offers (`lib/pos/list-locations.ts`). A warehouse reaching here — an
  // old `defaultPosLocationId`, or a client echoing back a counter the merchant
  // has since turned off — would scope the terminal to somewhere with no till,
  // and `decrementInventory` would then draw a counter sale down from stock
  // nobody is standing next to.
  const owned = await InventoryLocation.find(
    locationOwnerFilter(scope, {
      isActive: true,
      sellsAtCounter: { $ne: false },
    }),
  )
    .select("_id isDefault")
    .lean<Array<{ _id: unknown; isDefault?: boolean }>>();

  if (owned.some((location) => String(location._id) === configured)) {
    return configured;
  }

  const fallback = owned.find((location) => location.isDefault);
  return fallback ? String(fallback._id) : "";
}
