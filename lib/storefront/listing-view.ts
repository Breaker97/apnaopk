/**
 * How a product listing is viewed on a desktop screen: two, four or six cards
 * across, or a list with one product per row. Phones and tablets keep their
 * own 2/3-column tiers; only the lg tier is the shopper's choice.
 */
export const LISTING_DENSITIES = [2, 4, 6] as const;

export type ListingDensity = (typeof LISTING_DENSITIES)[number];

export type ListingViewChoice = ListingDensity | "list";

/** The toolbar's icon order. */
export const LISTING_VIEW_CHOICES: readonly ListingViewChoice[] = [
  ...LISTING_DENSITIES,
  "list",
];

export const DEFAULT_LISTING_VIEW: ListingViewChoice = 4;

/**
 * The shopper's pick lives in a cookie so the server can draw the right
 * column count on the first byte, on every page of the listing, on category
 * pages (they share the toolbar), and on the next visit. A plain preference,
 * not httpOnly: the toolbar writes it from the browser.
 */
export const LISTING_VIEW_COOKIE = "storify_listing_view";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The `document.cookie` string that remembers a view. */
export function listingViewCookieString(view: ListingViewChoice): string {
  return `${LISTING_VIEW_COOKIE}=${view}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

/**
 * Remember a pick in the browser. Cookies can be blocked (privacy modes,
 * sandboxed frames), in which case the pick simply is not kept past this page.
 */
export function saveListingView(view: ListingViewChoice): void {
  try {
    document.cookie = listingViewCookieString(view);
  } catch {
    // Not remembered; the caller's own state still shows the pick.
  }
}

/** The offered choice a value names, or null when it names none. */
function matchListingView(value: unknown): ListingViewChoice | null {
  return LISTING_VIEW_CHOICES.find((choice) => String(choice) === String(value)) ?? null;
}

/**
 * The view saved in a `document.cookie`-style string, or null when there is
 * none (or it is not one of the offered ones), so the caller decides what an
 * unset pick means.
 */
export function readListingViewCookie(cookieString: string): ListingViewChoice | null {
  for (const part of cookieString.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== LISTING_VIEW_COOKIE) continue;
    return matchListingView(rest.join("="));
  }
  return null;
}

/** Anything that is not one of the offered views is the default. */
export function parseListingView(value: unknown): ListingViewChoice {
  return matchListingView(value) ?? DEFAULT_LISTING_VIEW;
}

/**
 * The card picture's `sizes` hint from lg up, per view: the browser picks its
 * file from this, so a two-across grid asks for a wide one instead of
 * stretching a four-across file, and six across does not download one far
 * bigger than its tile. Measured against the widest layout (no filter rail),
 * so a narrower one can only over-fetch a little, never blur.
 *
 * The list's picture is a fixed column: `lg:w-36` on the card, which is this
 * width.
 */
export const LISTING_LIST_IMAGE_WIDTH = 144;

export const LISTING_IMAGE_SIZES: Record<ListingViewChoice, string> = {
  2: "50vw",
  4: "25vw",
  6: "17vw",
  list: `${LISTING_LIST_IMAGE_WIDTH}px`,
};
