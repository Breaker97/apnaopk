/**
 * How the storefront presents a product nothing can be bought from.
 *
 * One tri-state rather than two booleans ("hide?" plus "sort last?") because
 * the two are the same decision at different strengths — as separate switches
 * an admin can turn both on, and nothing in the query layer could say which
 * one wins.
 *
 * "Available" here always means {@link isProductAvailable}, never `stock > 0`:
 * a digital product and one set to keep selling past zero both sit at zero
 * stock and are still fully buyable, so no mode may move or hide them.
 */

export const OUT_OF_STOCK_DISPLAY = {
  /** Sold-out products keep their place in the sort. */
  SHOW: "show",
  /** Available products first; sold-out ones follow, in the same order. */
  LAST: "last",
  /** Sold-out products are dropped from listings entirely. */
  HIDE: "hide",
} as const;

export type OutOfStockDisplay =
  (typeof OUT_OF_STOCK_DISPLAY)[keyof typeof OUT_OF_STOCK_DISPLAY];

/** Ordered least- to most-aggressive. A readonly tuple so `z.enum()` takes it. */
export const OUT_OF_STOCK_DISPLAY_VALUES = [
  OUT_OF_STOCK_DISPLAY.SHOW,
  OUT_OF_STOCK_DISPLAY.LAST,
  OUT_OF_STOCK_DISPLAY.HIDE,
] as const;

/**
 * Deliberately `show`, which is what every storefront did before this setting
 * existed. A live store's grids must not silently reorder themselves because
 * its owner ran an upgrade; the install wizard opts new stores into `last`
 * instead, where there is no established behaviour to disturb.
 */
export const DEFAULT_OUT_OF_STOCK_DISPLAY: OutOfStockDisplay =
  OUT_OF_STOCK_DISPLAY.SHOW;

/** What a brand-new store is created with. See the note above. */
export const INSTALL_OUT_OF_STOCK_DISPLAY: OutOfStockDisplay =
  OUT_OF_STOCK_DISPLAY.LAST;

export function normalizeOutOfStockDisplay(value: unknown): OutOfStockDisplay {
  return (OUT_OF_STOCK_DISPLAY_VALUES as readonly string[]).includes(
    value as string,
  )
    ? (value as OutOfStockDisplay)
    : DEFAULT_OUT_OF_STOCK_DISPLAY;
}

/**
 * The availability facet a listing shows, and the `?stock=` it honours.
 *
 * With sold-out products hidden platform-wide the facet has nothing left to
 * offer — "In stock" narrows nothing and "Out of stock" empties the grid every
 * time — so it is dropped, and a stale `?stock=` from a bookmark is dropped
 * with it: an old link degrades to the full grid, not to "no products found".
 */
export function resolveStockFacet(
  requested: unknown,
  display: OutOfStockDisplay,
): { showStockFacet: boolean; stockParam: string; stockSet: Set<string> } {
  const showStockFacet = display !== OUT_OF_STOCK_DISPLAY.HIDE;
  const stockParam =
    showStockFacet && typeof requested === "string"
      ? requested
          .split(",")
          .filter((value) => value === "in" || value === "out")
          .join(",")
      : "";
  return { showStockFacet, stockParam, stockSet: new Set(stockParam.split(",")) };
}
