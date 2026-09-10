/**
 * The order a merchant's branches are tried in when dispatching a delivery.
 *
 * Deliberately free of `server-only` and of any import, exactly as
 * `lib/locations/maps-url.ts` is: the locations screen ranks the list it is
 * showing so the merchant can see and reorder the very sequence the checkout
 * will use, and the checkout ranks it again server-side. One implementation, so
 * the list a merchant drags cannot mean something different from the list an
 * order is dispatched against.
 *
 * `lib/locations/fulfillment-location.ts` re-exports this for server callers.
 */

/** The location fields the ranking reads. */
export type RankableLocation = {
  _id?: unknown;
  name?: string;
  isDefault?: boolean;
  fulfillmentPriority?: number;
};

export type FulfillmentCandidate = {
  id: string;
  name: string;
};

/**
 * Whether a branch can dispatch a delivery at all.
 *
 * `!== false` rather than `=== true`: rows written before the field existed
 * carry nothing, and a store's whole catalogue must not stop dispatching
 * because a migration has not run yet.
 *
 * This used to consult a second flag, `stocksInventory`, which no API or form
 * could set — only `scripts/backfill-location-vendor.ts` ever wrote it, and it
 * wrote `false` for every branch migrated off the old vendor pickup profile.
 * Those branches then showed "No delivery" while their own edit dialog showed
 * "Ship online orders from here" switched ON, and flipping that toggle changed
 * nothing, because the invisible flag still vetoed it. One editable flag
 * answers the question; a second, unreachable one only made the visible one
 * lie. `scripts/migrate-drop-stocks-inventory.mjs` carries the old value across
 * so no branch silently changes what it does.
 */
export function dispatchesOnlineOrders(location: {
  isActive?: boolean;
  fulfillsOnlineOrders?: boolean;
}): boolean {
  return (
    location.isActive !== false && location.fulfillsOnlineOrders !== false
  );
}

/**
 * Order the branches a vendor dispatches from, first choice first.
 *
 * Sorted in code rather than by Mongo because the tie-breakers matter as much
 * as the priority itself: a merchant who has never opened this setting has
 * every location sitting at the same default, and what they expect then is
 * their default location — the one already marked as their main place — not
 * whichever row the database happened to return first.
 */
export function rankFulfillmentCandidates(
  locations: RankableLocation[],
): FulfillmentCandidate[] {
  return [...locations]
    .sort((a, b) => {
      const priority =
        (Number(a.fulfillmentPriority) || 0) -
        (Number(b.fulfillmentPriority) || 0);
      if (priority !== 0) return priority;

      if (Boolean(a.isDefault) !== Boolean(b.isDefault)) {
        return a.isDefault ? -1 : 1;
      }

      return (a.name || "").localeCompare(b.name || "");
    })
    .map((location) => ({
      id: String(location._id),
      name: (location.name || "").trim(),
    }));
}
