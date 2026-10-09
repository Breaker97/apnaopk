/**
 * The header mega menu draws promo art in two very different frames (see
 * components/layout/store-header/mega-menu.tsx), so each gets its own locked
 * ratio. AI Studio can only emit 1:1, 2:3, or 3:2, so both generate at the
 * closest model size and are center-cropped down to the exact frame before
 * being applied — the same lock-and-crop contract the home-page promo cards
 * use, so the committed image already fits its slot.
 *
 * Side banner: one portrait card beside the link columns, 187px wide inside its
 * 236px panel and as tall as whatever the grid measures. Measured in the
 * browser, the column and row caps hold that between 269px (two groups of eight
 * links, one row) and 377px (four groups of four, two rows) — 0.695 to 0.496
 * wide-over-tall. No single lock can match a frame that moves, so 3:5 sits in
 * the middle of the band and the panel covers rather than stretches: at those
 * two extremes it trims 6.8% off the top and bottom, or 8.7% off each side.
 * Hence the prompt hint below — art wants a quiet margin, not a full bleed.
 *
 * Bottom cards: a pair of wide cards under the columns, measured at 432 × 122
 * in a four-column flyout. That frame is fixed, so a card authored here covers
 * it exactly with nothing trimmed.
 */

export const MEGA_MENU_PROMO_WIDTH = 1080 as const; // 3:5
export const MEGA_MENU_PROMO_HEIGHT = 1800 as const;

export const MEGA_MENU_BOTTOM_PROMO_WIDTH = 1296 as const; // 432 × 3
export const MEGA_MENU_BOTTOM_PROMO_HEIGHT = 366 as const; // 122 × 3

/** The frame is fixed, but how tall it renders moves with the link grid. */
export const MEGA_MENU_PROMO_PROMPT_HINT =
  "Describe a tall portrait promo image for this category. Its height follows the link columns beside it and the edges may be trimmed, so keep any headline and the key subject centred with a quiet margin all round.";
