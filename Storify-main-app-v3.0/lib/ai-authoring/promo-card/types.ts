/**
 * The home page "Promotions & Offers" bento grid renders five cards in three
 * fixed frames (see components/store/home-promotions-offers.tsx): two tall
 * portrait cards at 317:565, two near-square cards at 317:272, and one wide
 * banner at 654:272. AI Studio can only emit 1:1, 2:3, or 3:2, so each slot
 * generates at the closest model size and is center-cropped down to its exact
 * frame before it is applied — the same lock-and-crop contract the blog
 * featured image uses.
 *
 * The locked dimensions below are the storefront ratios scaled ×3, keeping the
 * exact aspect while staying near the generated image's resolution.
 */

export const PROMO_TALL_WIDTH = 951 as const; // 317 × 3
export const PROMO_TALL_HEIGHT = 1695 as const; // 565 × 3

export const PROMO_SQUARE_WIDTH = 951 as const; // 317 × 3
export const PROMO_SQUARE_HEIGHT = 816 as const; // 272 × 3

export const PROMO_WIDE_WIDTH = 1962 as const; // 654 × 3
export const PROMO_WIDE_HEIGHT = 816 as const; // 272 × 3
