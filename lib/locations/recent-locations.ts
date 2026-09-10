/**
 * The last few places a shopper picked, kept on the device.
 *
 * A marketplace with hundreds of vendor cities cannot show them all in a
 * popover, and the ones a shopper actually reuses are a very short list. Recent
 * picks put those at the top so the common case is one click, without a server
 * round trip or an account.
 */

import {
  type ShopperLocation,
  parseShopperLocation,
} from "@/lib/locations/shopper-location";

export const RECENT_LOCATIONS_KEY = "storify.recentLocations";

/**
 * Three, not ten: the list sits above the city list in a fixed-height popover,
 * and a long "recent" section would push the thing it is meant to shortcut off
 * the screen.
 */
export const MAX_RECENT_LOCATIONS = 3;

const sameLocation = (a: ShopperLocation, b: ShopperLocation): boolean =>
  a.label.trim().toLowerCase() === b.label.trim().toLowerCase() &&
  a.precise === b.precise;

/** Read the remembered list, dropping any entry that no longer parses. */
export function readRecentLocations(): ShopperLocation[] {
  try {
    const raw = window.localStorage.getItem(RECENT_LOCATIONS_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(parseShopperLocation)
      .filter((entry): entry is ShopperLocation => entry !== null)
      .slice(0, MAX_RECENT_LOCATIONS);
  } catch {
    // Storage blocked (private mode) or written by an older version. Recents
    // are a convenience, so an unreadable list is simply an empty one.
    return [];
  }
}

/**
 * Move a location to the front of the list and return the new list.
 *
 * Returns the list rather than only writing it so the caller can update its
 * state from the same value that was persisted, instead of re-reading storage
 * that may have failed to write.
 */
export function rememberRecentLocation(
  location: ShopperLocation,
): ShopperLocation[] {
  const next = [
    location,
    ...readRecentLocations().filter((entry) => !sameLocation(entry, location)),
  ].slice(0, MAX_RECENT_LOCATIONS);

  try {
    window.localStorage.setItem(RECENT_LOCATIONS_KEY, JSON.stringify(next));
  } catch {
    // Unwritable storage still leaves `next` correct for this session.
  }

  return next;
}

/** Forget every remembered place, for "clear location". */
export function clearRecentLocations(): void {
  try {
    window.localStorage.removeItem(RECENT_LOCATIONS_KEY);
  } catch {
    // Nothing to do: an unwritable store had nothing to clear.
  }
}
