/**
 * How a promo image lands in the frame the storefront draws it in.
 *
 * Both mega menu frames use object-cover (see the reasoning in ./types.ts), so
 * art authored at the wrong ratio is not stretched — it is trimmed, and the
 * author never finds out unless the builder says so. This is the maths behind
 * the fit chip on each promo slot, kept out of the component so it can be
 * tested on its own.
 */

import {
  MEGA_MENU_BOTTOM_PROMO_HEIGHT,
  MEGA_MENU_BOTTOM_PROMO_WIDTH,
  MEGA_MENU_PROMO_HEIGHT,
  MEGA_MENU_PROMO_WIDTH,
} from "@/lib/ai-authoring/mega-menu-promo/types";

/** The two shapes the storefront draws promo art in. */
export type PromoFrame = "card" | "banner";

export const PROMO_FRAMES: Record<
  PromoFrame,
  { width: number; height: number }
> = {
  card: {
    width: MEGA_MENU_BOTTOM_PROMO_WIDTH,
    height: MEGA_MENU_BOTTOM_PROMO_HEIGHT,
  },
  banner: { width: MEGA_MENU_PROMO_WIDTH, height: MEGA_MENU_PROMO_HEIGHT },
};

/** Below this the crop is a rounding error, not something to warn about. */
const EXACT_FIT_TOLERANCE = 0.01;

export type PromoFit = {
  /** Share of the cropped axis cover will discard, 0–1. */
  trimmed: number;
  /** Which pair of edges loses it. */
  edges: "sides" | "top and bottom";
  exact: boolean;
};

export function getPromoFit(
  size: { width: number; height: number } | null,
  frame: PromoFrame,
): PromoFit | null {
  if (!size || size.width <= 0 || size.height <= 0) return null;

  const { width, height } = PROMO_FRAMES[frame];
  const frameRatio = width / height;
  const imageRatio = size.width / size.height;
  const kept =
    Math.min(frameRatio, imageRatio) / Math.max(frameRatio, imageRatio);
  const trimmed = 1 - kept;

  return {
    trimmed,
    // Wider than the frame means the sides overflow, so those are what go.
    edges: imageRatio > frameRatio ? "sides" : "top and bottom",
    exact: trimmed < EXACT_FIT_TOLERANCE,
  };
}
