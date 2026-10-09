/**
 * Locating one saved address inside a shopper's `User.addresses` array.
 *
 * Addresses used to be addressed purely by array position, which is only stable
 * for as long as nobody edits the list: deleting an address in one tab shifts
 * every later index in another, so a concurrent edit or set-default landed on
 * whichever address slid into that slot. The sub-schema now carries an `_id`.
 *
 * Entries written before that change have no `_id`, and none is minted for them
 * retroactively — a backfill would have to run before the deploy that needs it,
 * and getting that order wrong breaks every saved address at once. So both
 * forms are accepted here instead, with the id preferred whenever it is present.
 * A legacy entry gains an id the first time it is rewritten.
 */

/**
 * Only the identity field matters; the rest of the address is irrelevant here.
 *
 * The index signature is what lets a legacy address — an object with no `_id`
 * at all — be passed without a cast, which is precisely the case this module
 * exists to keep working.
 */
export type IdentifiableAddress = { _id?: unknown; [key: string]: unknown };

/**
 * Send `_id` to the client as a plain string.
 *
 * The address routes read through the raw driver, so an id arrives as an
 * ObjectId. It would survive `JSON.stringify` as a string by accident, but the
 * client compares it against the id it sends back, and leaving that to
 * serializer behaviour makes an API contract depend on something unstated.
 */
export function serializeAddresses(addresses: unknown): unknown[] {
  if (!Array.isArray(addresses)) return [];
  return addresses.map((address) =>
    address && typeof address === "object" && "_id" in address
      ? { ...address, _id: String((address as { _id: unknown })._id) }
      : address,
  );
}

type SavedAddressSelector = {
  /** Preferred. Matches `_id` regardless of ObjectId/string representation. */
  id?: string;
  /** Legacy fallback, used only when no id is given or the id is not found. */
  index?: number;
};

/**
 * Resolve a selector to a position in `addresses`, or `null` when it matches
 * nothing.
 *
 * Returning `null` rather than throwing keeps the decision with the caller:
 * every route reports "invalid address" its own way, and a route that resolves
 * a selector for a set-default has a different error shape than one deleting.
 */
export function resolveAddressIndex(
  addresses: IdentifiableAddress[],
  selector: SavedAddressSelector,
): number | null {
  const id = selector.id?.trim();

  if (id) {
    const found = addresses.findIndex(
      (address) => address?._id != null && String(address._id) === id,
    );
    // A supplied id that matches nothing is not silently downgraded to the
    // index: the id is the more specific claim, and falling back would edit an
    // unrelated address at that position — exactly the bug ids exist to prevent.
    return found === -1 ? null : found;
  }

  const { index } = selector;
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= addresses.length
  ) {
    return null;
  }

  return index;
}
