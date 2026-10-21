/**
 * How many categories the all-categories page draws per row on a desktop
 * screen. Phones and tablets keep their own 2/3-column tiers; only the lg tier
 * is the shopper's choice, the way the product browser's desktop columns are.
 */
export const CATEGORY_DENSITIES = [4, 6, 8] as const;

export type CategoryDensity = (typeof CATEGORY_DENSITIES)[number];

export const DEFAULT_CATEGORY_DENSITY: CategoryDensity = 6;

/**
 * One page holds whole rows at every density: 4, 6 and 8 all divide 24, so the
 * last row of a full page is never left half empty whichever one is picked.
 */
export const CATEGORIES_PAGE_SIZE = 24;

/**
 * The shopper's pick lives in a cookie so the server can draw the right
 * column count on the first byte, on every page of the list, and on the next
 * visit. A plain preference, not httpOnly: the toggle writes it from the
 * browser.
 */
export const CATEGORY_DENSITY_COOKIE = "storify_categories_density";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The `document.cookie` string that remembers a density. */
export function categoryDensityCookieString(density: CategoryDensity): string {
  return `${CATEGORY_DENSITY_COOKIE}=${density}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

/**
 * Remember a pick in the browser. Cookies can be blocked (privacy modes,
 * sandboxed frames), in which case the pick simply is not kept past this page.
 */
export function saveCategoryDensity(density: CategoryDensity): void {
  try {
    document.cookie = categoryDensityCookieString(density);
  } catch {
    // Not remembered; the caller's own state still shows the pick.
  }
}

/**
 * The density saved in a `document.cookie`-style string, or null when there is
 * none (or it is not one of the offered ones), so the caller decides what an
 * unset pick means.
 */
export function readCategoryDensityCookie(
  cookieString: string,
): CategoryDensity | null {
  for (const part of cookieString.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== CATEGORY_DENSITY_COOKIE) continue;
    const value = rest.join("=");
    return CATEGORY_DENSITIES.find((density) => String(density) === value) ?? null;
  }
  return null;
}

/** Anything that is not one of the offered densities is the default. */
export function parseCategoryDensity(value: unknown): CategoryDensity {
  const number = typeof value === "string" ? Number(value) : value;
  return (
    CATEGORY_DENSITIES.find((density) => density === number) ??
    DEFAULT_CATEGORY_DENSITY
  );
}
