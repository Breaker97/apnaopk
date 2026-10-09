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
 *   2 groups + side promo   → 2 cols × 1 row  → 8 links per group
 *   4 groups + side promo   → 2 cols × 2 rows → 4 links per group
 *   4 groups + bottom promo → 4 cols × 1 row  → 4 links per group
 *
 * A fifth column or a third row simply has nowhere to go.
 */
const MAX_MEGA_GROUP_COLUMNS = 4;
const MAX_MEGA_GROUP_ROWS = 2;
/** A side banner eats ~236px of the flyout, leaving room for two columns. */
const MEGA_COLUMNS_WITH_SIDE_PROMO = 2;
/** Children with no children of their own render as a flat multi-column list. */
export const MEGA_FLAT_COLUMNS = 3;
/** One row of columns can run tall; two rows have to halve to stay in budget. */
export const MEGA_LINKS_PER_GROUP_TALL = 8;
const MEGA_LINKS_PER_GROUP_SHORT = 4;
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
 */
export function getMegaLinkLimit(rows: number, hasBottomPromo: boolean) {
  return rows <= 1 && !hasBottomPromo
    ? MEGA_LINKS_PER_GROUP_TALL
    : MEGA_LINKS_PER_GROUP_SHORT;
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
