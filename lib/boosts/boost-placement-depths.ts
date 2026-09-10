/**
 * How deep the ladder renders on each storefront placement.
 *
 * The ladder is global — one rung ordering shared by every surface — but the
 * surfaces are not the same size, and the three depths live in two different
 * places: the home rail's is a home-page-builder section limit, while the
 * listing and product-page depths are boosting settings.
 *
 * This module is deliberately PURE so the admin ladder (a client component) can
 * import it. The loader that reads Settings lives in `lib/sponsored-products.ts`
 * next to the other cached boosting reads — pulling it in here would drag
 * `unstable_cache`, `revalidatePath` and mongoose into the client bundle, which
 * fails the build rather than tree-shaking away.
 */

import {
  SPONSORED_PRODUCTS_LIMIT_MAX,
  SPONSORED_PRODUCTS_LIMIT_MIN,
} from "@/lib/site-config/home-page-config";

export type SponsoredPlacementDepths = {
  home: number;
  listing: number;
  productPage: number;
};

type PositionVisibility = {
  home: boolean;
  listing: boolean;
  productPage: boolean;
};

const DEFAULT_PLACEMENT_DEPTHS: SponsoredPlacementDepths = {
  home: 8,
  listing: 2,
  productPage: 8,
};

/** Placement depth can never exceed the ladder's own ceiling. */
export const MAX_PLACEMENT_DEPTH = 12;

function clampDepth(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Normalize the three raw settings values into usable depths. */
export function resolvePlacementDepths(raw: {
  homeLimit?: number;
  listingSlots?: number;
  productPageSlots?: number;
}): SponsoredPlacementDepths {
  return {
    home: clampDepth(
      raw.homeLimit,
      DEFAULT_PLACEMENT_DEPTHS.home,
      SPONSORED_PRODUCTS_LIMIT_MIN,
      SPONSORED_PRODUCTS_LIMIT_MAX,
    ),
    listing: clampDepth(
      raw.listingSlots,
      DEFAULT_PLACEMENT_DEPTHS.listing,
      1,
      MAX_PLACEMENT_DEPTH,
    ),
    productPage: clampDepth(
      raw.productPageSlots,
      DEFAULT_PLACEMENT_DEPTHS.productPage,
      1,
      MAX_PLACEMENT_DEPTH,
    ),
  };
}

/**
 * Where a rung actually appears. A rung visible on no placement is unsellable
 * and must be flagged rather than quietly sold.
 */
export function getPositionVisibility(
  position: number,
  depths: SponsoredPlacementDepths,
): PositionVisibility {
  return {
    home: position <= depths.home,
    listing: position <= depths.listing,
    productPage: position <= depths.productPage,
  };
}

/** True when a rung renders nowhere at the current depths. */
export function isPositionUnreachable(
  position: number,
  depths: SponsoredPlacementDepths,
): boolean {
  const reach = getPositionVisibility(position, depths);
  return !reach.home && !reach.listing && !reach.productPage;
}
