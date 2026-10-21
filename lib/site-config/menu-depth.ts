export const MAX_MEGA_MENU_DEPTH = 3;
export const MAX_MEGA_MENU_ROOT_ITEMS = 7;
export const MAX_MEGA_MENU_LEVEL_2_ITEMS = 8;

/*
 * Mega menu flyout grid budget.
 *
 * The flyout has to stay inside the store container at 1280px and it has to
 * stay a predictable height, because the side promo image is stretched to
 * whatever the link grid measures. Both come from two hard caps — never more
 * than four columns, never more than two rows — plus a per-group link cap that
 * drops when the grid gets taller. Merchants can build exactly three shapes:
 *
 *   2 groups + side promo   → 2 cols × 1 row  → 8–10 links per group
 *   4 groups + side promo   → 2 cols × 2 rows → 4 links per group
 *   4 groups + bottom promo → 4 cols × 1 row  → 4 links per group
 *
 * A fifth column or a third row simply has nowhere to go.
 */
const MAX_MEGA_GROUP_COLUMNS = 4;
const MAX_MEGA_GROUP_ROWS = 2;
/** A side banner eats 210px of the flyout, leaving room for two columns. */
const MEGA_COLUMNS_WITH_SIDE_PROMO = 2;
/** Children with no children of their own render as a flat multi-column list. */
export const MEGA_FLAT_COLUMNS = 3;
/** One row of columns can run tall; two rows have to halve to stay in budget. */
export const MEGA_LINKS_PER_GROUP_TALL = 8;
/** However tall the rail, one column never lists more than this. */
const MEGA_LINKS_PER_GROUP_MAX = 10;
const MEGA_LINKS_PER_GROUP_SHORT = 4;

/*
 * Flyout geometry the tall cap is measured against. Each value mirrors a class
 * in components/layout/store-header/mega-menu.tsx — change one, change both.
 */
const MEGA_RAIL_ROW_HEIGHT = 36; // rail row: h-9
const MEGA_RAIL_LIST_PADDING = 8; // rail list: p-1, top + bottom
const MEGA_RAIL_LIST_MAX_HEIGHT = 400; // rail list: max-h-[400px]
// Grid pt-1 + h-9 heading + mb-1.5 above the links, grid pb-3 below them.
const MEGA_COLUMN_CHROME_HEIGHT = 4 + 36 + 6 + 12;
// A link is 26px (py-[3px] + leading-5) plus the 1px gap to the next. "View
// all" is a little shorter, so a row of this height fits either of them.
const MEGA_LINK_ROW_HEIGHT = 27;

/**
 * Links one row of columns lists before "View all". A fixed eight left a tall
 * rail beside short columns with a slab of empty panel under them, so the cap
 * grows into whatever the rail's height leaves room for — keeping one row free
 * for "View all" — up to ten. It never drops below eight: next to a short rail
 * the flyout simply runs taller than the rail, as it always has.
 */
export function getMegaTallLinkLimit(rootCount: number) {
  const railList = Math.min(
    rootCount * MEGA_RAIL_ROW_HEIGHT + MEGA_RAIL_LIST_PADDING,
    MEGA_RAIL_LIST_MAX_HEIGHT,
  );
  const rows = Math.floor(
    (railList - MEGA_COLUMN_CHROME_HEIGHT + 1) / MEGA_LINK_ROW_HEIGHT,
  );
  return Math.min(
    MEGA_LINKS_PER_GROUP_MAX,
    Math.max(MEGA_LINKS_PER_GROUP_TALL, rows - 1),
  );
}

/**
 * How many of a group's links get drawn. "View all" takes a link's room, so
 * hiding a single link behind it gains nothing: that last link is drawn
 * instead. Only in one row of columns: two rows and the banner strip are
 * budgeted to the pixel and have no slack for it.
 */
export function getMegaVisibleLinkCount(
  total: number,
  linkLimit: number,
  isTall: boolean,
) {
  if (isTall && total === linkLimit + 1) return total;
  return Math.min(total, linkLimit);
}
/** Bottom promo is a fixed pair of cards, not a variable strip. */
export const MEGA_BOTTOM_PROMO_CARDS = 2;

/** How many columns the group grid gets, which the side promo decides. */
export function getMegaGroupColumns(hasSidePromo: boolean) {
  return hasSidePromo ? MEGA_COLUMNS_WITH_SIDE_PROMO : MAX_MEGA_GROUP_COLUMNS;
}

/** Total column slots a category can fill — columns × the two-row cap. */
export function getMegaGroupLimit(hasSidePromo: boolean) {
  return getMegaGroupColumns(hasSidePromo) * MAX_MEGA_GROUP_ROWS;
}

/**
 * Links a single group may show before it collapses into "View all". A second
 * row of columns, or a strip of promo cards under them, already spends the
 * flyout's height budget — so the columns themselves have to get shorter.
 * A single row takes its cap from the rail beside it (`rootCount` rows).
 */
export function getMegaLinkLimit(
  rows: number,
  hasBottomPromo: boolean,
  rootCount = 0,
) {
  return isMegaTallShape(rows, hasBottomPromo)
    ? getMegaTallLinkLimit(rootCount)
    : MEGA_LINKS_PER_GROUP_SHORT;
}

/** One row of columns with no banner strip under it: the shape that runs tall. */
export function isMegaTallShape(rows: number, hasBottomPromo: boolean) {
  return rows <= 1 && !hasBottomPromo;
}

type NestedMenuItem = {
  children?: NestedMenuItem[];
};

function countMenuTreeItems(items: NestedMenuItem[] = []): number {
  return items.reduce(
    (count, item) => count + 1 + countMenuTreeItems(item.children || []),
    0,
  );
}

export function getMenuTreeMaxDepth(
  items: NestedMenuItem[] = [],
  depth = 1,
): number {
  return items.reduce((maxDepth, item) => {
    const itemDepth = Math.max(
      depth,
      getMenuTreeMaxDepth(item.children || [], depth + 1),
    );
    return Math.max(maxDepth, itemDepth);
  }, 0);
}

export function trimMenuTreeDepth<T extends { children?: T[] }>(
  items: T[] = [],
  maxDepth = MAX_MEGA_MENU_DEPTH,
  depth = 1,
): { items: T[]; trimmedCount: number } {
  let trimmedCount = 0;

  const trimmedItems = items.map((item) => {
    const children = Array.isArray(item.children) ? item.children : [];
    if (depth >= maxDepth) {
      trimmedCount += countMenuTreeItems(children);
      return { ...item, children: [] };
    }

    const trimmed = trimMenuTreeDepth(children, maxDepth, depth + 1);
    trimmedCount += trimmed.trimmedCount;
    return { ...item, children: trimmed.items };
  });

  return { items: trimmedItems, trimmedCount };
}
