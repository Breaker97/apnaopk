import {
  applyLadderToResults,
  buildSponsoredLane,
  getSponsoredLadderPool,
  getSponsoredPlacementDepths,
  getStorefrontBoostingSettings,
  laneHasSponsored,
  resolveLadderAt,
} from "@/lib/boosts/sponsored-products";
import { hasLocationCoordinates } from "@/lib/locations/shopper-location";
import {
  getStorefrontProductCards,
  type StorefrontProductCard,
} from "@/lib/products/storefront-product-cards";
import {
  SPONSORED_PRODUCTS_LIMIT_MAX,
  SPONSORED_PRODUCTS_LIMIT_MIN,
} from "@/lib/site-config/home-page-config";

/**
 * Where paid placements go, for every surface that shows them: the product
 * listing, the product page's rail and the home rail, on the web and in the
 * app. Each answers the products in their order, with the sponsored ones
 * marked (`sponsored`, `sponsoredCampaignId`); drawing them, and the
 * disclosure, is the caller's. The ladder itself (which booking holds which
 * rung, strict-index composition) is lib/boosts/sponsored-products.ts.
 */

/** A rail's cards in slot order: the rungs sold, organic fillers between. */
type SponsoredLane = ReturnType<typeof buildSponsoredLane<StorefrontProductCard>>;

/** What a listing shows, as far as paid placements care. */
type SponsoredListingContext = {
  page?: number;
  vendor?: string;
  preorder?: boolean;
  pickupNearby?: unknown;
  lat?: unknown;
  lng?: unknown;
  city?: string;
  search?: string;
  brand?: string;
  collection?: string;
  minPrice?: unknown;
  maxPrice?: unknown;
};

/**
 * Whether a listing takes paid placements at all: its first page, with
 * nothing that would make a global ad misrepresent it.
 *
 * Contexts where a sponsored card would misrepresent the grid: a vendor's own
 * storefront shelf (another vendor's ad inside it), the curated pre-order
 * shelf, and location-narrowed grids (a sponsored card carries no locality
 * relevance and would break the "near you" claim).
 *
 * Search, brand, collection and the price facets are excluded for the same
 * reason: the ladder is global, so on those pages it would splice a phone case
 * into `?search=sofa`, a non-Nike product into `?brand=nike`, or a $900 item
 * into a grid the shopper capped at $50. An ad matching none of the active
 * facets is exactly the misrepresentation these exclusions exist to prevent.
 */
function listingTakesSponsored(listing: SponsoredListingContext): boolean {
  const isFirstPage = !listing.page || listing.page === 1;
  if (!isFirstPage) return false;
  return !(
    listing.vendor ||
    listing.preorder ||
    listing.pickupNearby ||
    hasLocationCoordinates(listing.lat, listing.lng) ||
    listing.city ||
    listing.search ||
    listing.brand ||
    listing.collection ||
    listing.minPrice ||
    listing.maxPrice
  );
}

/**
 * Sponsored-slot injection into a listing's results, page 1 only. Additive by
 * design: organic order, counts, and pagination are untouched (page 1 simply
 * renders a few extra cards), and pages 2+ never carry sponsored items — so
 * canonical URLs and page semantics stay exactly as before. A sponsored
 * product that already sits in the organic page-1 results is badged in place
 * instead of duplicated.
 */
export async function placeSponsoredInListing<
  T extends { _id: unknown; sponsored?: boolean; sponsoredCampaignId?: string },
>(
  products: T[],
  listing: SponsoredListingContext,
): Promise<Array<T & { sponsoredInjected?: boolean }>> {
  if (products.length === 0 || !listingTakesSponsored(listing)) return products;

  let boosting;
  try {
    boosting = await getStorefrontBoostingSettings();
  } catch {
    return products;
  }
  if (!boosting.enabled || !boosting.placements.listing) return products;

  const [pool, depths] = await Promise.all([
    getSponsoredLadderPool({ hideOutOfStock: boosting.hideOutOfStock }),
    getSponsoredPlacementDepths(),
  ]);
  const ladder = resolveLadderAt(pool);
  if (ladder.length === 0) return products;

  // Raising the settings ceiling to 12 without this would let page 1 render a
  // dozen ads above a dozen organic cards.
  const depth = Math.max(
    0,
    Math.min(depths.listing, Math.ceil(products.length / 3)),
  );
  if (depth === 0) return products;

  // The organic page-1 results ARE the fillers, so an unsold rung simply keeps
  // the card already there. Each sold rung takes its OWN slot — see
  // applyLadderToResults for why a lane index cannot be used here.
  return applyLadderToResults(products, ladder, depth);
}

/**
 * The product page's rail — a MIXED shelf, like the home rail: position N at
 * slot N, unsold rungs filled with regular products from the product's
 * category, and nothing promoted upward. Null when boosting or this placement
 * is off, or when nothing is sold within the rail's own depth: a rail of
 * organic cards must not carry a paid-placement note.
 */
export async function getProductPageSponsoredLane(product: {
  productId: string;
  categoryId?: string;
}): Promise<SponsoredLane | null> {
  const boosting = await getStorefrontBoostingSettings();
  if (!boosting.enabled || !boosting.placements.productPage) return null;

  const [pool, depths] = await Promise.all([
    getSponsoredLadderPool({ hideOutOfStock: boosting.hideOutOfStock }),
    getSponsoredPlacementDepths(),
  ]);

  // The viewed product is dropped AFTER the cached fetch — putting it in the
  // query would key one cache entry per product page.
  const ladder = resolveLadderAt(pool, { excludeProductId: product.productId });
  const depth = depths.productPage;

  const fillers = await getStorefrontProductCards({
    limit: depth * 2,
    excludeIds: [product.productId],
    ...(product.categoryId ? { categoryIds: [product.categoryId] } : {}),
    hideOutOfStock: boosting.hideOutOfStock,
  });

  const lane = buildSponsoredLane(ladder, fillers, depth);
  return laneHasSponsored(lane) ? lane : null;
}

/** The home rail: off, or live with its lane and whether any rung in it is sold. */
type HomeSponsoredRail =
  | { live: false }
  | { live: true; lane: SponsoredLane; sold: boolean };

/**
 * The home rail — a MIXED shelf under strict-index rendering: the product
 * holding position N sits at slot N, and an unsold rung shows a regular
 * product rather than collapsing the row. `limit` is the section's own
 * setting; the published home's depth stands in without one.
 *
 * A live rail with nothing sold WITHIN ITS OWN DEPTH is not drawn: a booking
 * at position 9 with a home depth of 4 reaches this rail not at all, and
 * printing "includes paid placements" over four organic cards would be an
 * affirmatively false disclosure.
 */
export async function getHomeSponsoredRail(options: {
  limit?: number;
}): Promise<HomeSponsoredRail> {
  const boosting = await getStorefrontBoostingSettings();
  if (!boosting.enabled || !boosting.placements.home) return { live: false };

  const depths = await getSponsoredPlacementDepths();
  const depth = Math.min(
    SPONSORED_PRODUCTS_LIMIT_MAX,
    Math.max(
      SPONSORED_PRODUCTS_LIMIT_MIN,
      Math.floor(options.limit ?? 0) || depths.home || 8,
    ),
  );

  const [pool, fillers] = await Promise.all([
    getSponsoredLadderPool({ hideOutOfStock: boosting.hideOutOfStock }),
    // A constant limit, not depth + ladder.length: getStorefrontProductCards is
    // cached on its serialized argument, and a ladder-dependent limit would mint
    // a fresh cache entry every time a booking starts or ends.
    getStorefrontProductCards({
      limit: SPONSORED_PRODUCTS_LIMIT_MAX * 2,
      hideOutOfStock: boosting.hideOutOfStock,
    }),
  ]);

  const lane = buildSponsoredLane(resolveLadderAt(pool), fillers, depth);
  return { live: true, lane, sold: laneHasSponsored(lane) };
}
