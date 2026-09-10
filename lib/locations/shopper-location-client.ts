/**
 * Reading the shopper's saved location in the browser.
 *
 * The location is written to a cookie and to localStorage by the picker (see
 * `lib/locations/shopper-location.ts` for why both). Anything that needs the
 * saved place outside the picker — the header pill, checkout — reads it through
 * here so there is exactly one answer to "what did the shopper set", with the
 * cookie preferred: it is what the server rendered the page against, so a
 * client that disagreed with it would repaint the place the shopper just saw.
 *
 * Browser-only by construction: every function touches `document` or `window`
 * and must be called from an effect or an event handler, never during render.
 */

import {
  LOCATION_COOKIE,
  LOCATION_STORAGE_KEY,
  type ShopperLocation,
  parseLocationCookie,
  parseShopperLocation,
} from "@/lib/locations/shopper-location";

/** The raw cookie value, or `undefined` when no location cookie is set. */
function readBrowserLocationCookie(): string | undefined {
  const prefix = `${LOCATION_COOKIE}=`;
  return document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}

/** The localStorage copy, parsed, or `null` when absent or unreadable. */
function readStoredLocationEntry(): ShopperLocation | null {
  try {
    const raw = window.localStorage.getItem(LOCATION_STORAGE_KEY);
    return raw ? parseShopperLocation(JSON.parse(raw)) : null;
  } catch {
    // Storage blocked (private mode) or written by an older build. A location
    // is a convenience, so an unreadable one is simply no location.
    return null;
  }
}

/**
 * The location the shopper last applied, as the browser knows it.
 *
 * Cookie first, then localStorage: the cookie expires and can be cleared by the
 * browser independently of storage, and a shopper whose cookie lapsed still
 * expects the place they picked last month to come back.
 */
export function readStoredShopperLocationFromBrowser(): ShopperLocation | null {
  return parseLocationCookie(readBrowserLocationCookie()) ?? readStoredLocationEntry();
}
