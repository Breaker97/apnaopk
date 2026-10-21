/**
 * Values the listing toolbar shares with the server pages that render it.
 *
 * These cannot live in `listing-view.tsx`: that file is `"use client"`, and a
 * non-component export of a client module reaches a server component as a
 * client reference — a function that throws when called — not as the string
 * or number it was declared as. The grid class landed in the page's markup as
 * that error text, so the toolbar's view choices never reached the grid.
 */

/**
 * The grid class a listing's grid must carry to follow the toolbar: its lg
 * column count reads the `--listing-cols` the shell sets (1 in list view).
 *
 * In list view the rows sit 20px apart whatever the theme's own row gap is:
 * each row carries a rule under it, so the rule sits mid-way between rows.
 */
export const LISTING_GRID_COLUMNS_CLASS =
  "lg:grid-cols-[repeat(var(--listing-cols,4),minmax(0,1fr))] lg:group-data-[view=list]/listing:gap-y-5";

/**
 * The loading skeleton's columns: the shell's grid choice, and four across
 * while the list is chosen (a list row is not a skeleton card).
 */
export const LISTING_SKELETON_COLUMNS_CLASS =
  "lg:grid-cols-[repeat(var(--listing-skeleton-cols,4),minmax(0,1fr))]";

/**
 * Cards in ONE row at the widest view — the builder's framed render of a
 * listing.
 *
 * The frame is there to show the page's chrome and its card design, not the
 * depth of the catalogue: a full page of products made every listing preview
 * a tall scroll of the same card, and an infinite grid inside a short frame
 * kept fetching the next page nobody could see. Four is `--listing-cols`'s
 * default, which the preview frame stays on (it does not read the shopper's
 * saved view), so the previewed row is exactly full.
 */
export const LISTING_PREVIEW_ROW = 4;
