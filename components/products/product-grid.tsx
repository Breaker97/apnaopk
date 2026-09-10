import {
  ModernProductCardSkeleton,
  type ModernProduct,
} from "./modern-product-card";
import { ProductGridClient } from "./product-grid-client";
import { ProductGridInfinite } from "./product-grid-infinite";
import {
  ProductGridClearLocation,
  ProductGridLocationNotice,
} from "./product-grid-location-notice";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { ElectronicsPager } from "@/components/store/electronics-pager";
import { type Locale } from "@/config/i18n.config";
import { getStorefrontProducts } from "@/lib/products/storefront-products";
import {
  buildProductApiQuery,
  buildProductGridPageHref,
} from "@/lib/products/product-grid-pagination";
import { getTranslations } from "next-intl/server";
import { hasLocationCoordinates } from "@/lib/locations/shopper-location";
import {
  applyLadderToResults,
  getSponsoredLadderPool,
  getSponsoredPlacementDepths,
  getStorefrontBoostingSettings,
  resolveLadderAt,
} from "@/lib/boosts/sponsored-products";

interface ProductGridProps {
  locale: Locale;
  category?: string;
  collection?: string;
  brand?: string;
  vendor?: string;
  search?: string;
  minPrice?: string;
  maxPrice?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: number;
  /** Products per page; the query layer's default (12) when omitted. */
  limit?: number;
  preorder?: boolean;
  emptyMessage?: string;
  /** Shopper location, narrowing the grid to vendors at that place. */
  lat?: string;
  lng?: string;
  radius?: string;
  city?: string;
  /** "Pickup near me" — narrows further to vendors with a collection point. */
  pickupNearby?: string;
  /** Availability facets — see `getStorefrontProducts`; both at once cancel. */
  inStock?: boolean;
  outOfStock?: boolean;
  /** Page-specific URL fields, such as the pre-order route's `sort`. */
  paginationParams?: Record<string, string | undefined>;
  /** Extra classes for the card grid itself, e.g. a themed column override. */
  gridClassName?: string;
  /**
   * How the pager reads. "electronics" renders the theme's round-chip pager
   * with a "Showing x – y of z" line instead of the stock pagination bar; the
   * links and the grid query are identical either way.
   */
  appearance?: "default" | "electronics";
  /**
   * Continue the grid on scroll instead of paging through it.
   *
   * Opt-in per listing: numbered pages are the right shape for a curated
   * category or a single vendor's shelf, where a shopper is looking for a known
   * item and wants to be able to come back to page 3. The full catalogue is the
   * case that reads as browsing, and that is where paging back and forth costs
   * a round trip and a scroll position every time.
   */
  infinite?: boolean;
}

async function fetchProducts(props: ProductGridProps) {
  try {
    return await getStorefrontProducts<ModernProduct>({
      category: props.category,
      collection: props.collection,
      brand: props.brand,
      vendor: props.vendor,
      search: props.search,
      minPrice: props.minPrice,
      maxPrice: props.maxPrice,
      sortBy: props.sortBy,
      sortOrder: props.sortOrder,
      page: props.page,
      limit: props.limit,
      preorder: props.preorder,
      lat: props.lat,
      lng: props.lng,
      radius: props.radius,
      city: props.city,
      pickupNearby: props.pickupNearby,
      inStock: props.inStock,
      outOfStock: props.outOfStock,
      cardFieldsOnly: true,
    });
  } catch {
    return {
      data: [],
      pagination: {
        page: 1,
        limit: props.limit ?? 12,
        total: 0,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    };
  }
}

export async function ProductGrid(props: ProductGridProps) {
  const t = await getTranslations({ locale: props.locale });
  const result = await fetchProducts(props);

  const products = Array.isArray(result.data) ? result.data : [];
  const pagination = result.pagination || {
    page: 1,
    limit: props.limit ?? 12,
    totalPages: 1,
    total: 0,
  };

  const hasCoordinates = hasLocationCoordinates(props.lat, props.lng);
  /**
   * Whether this grid is actually narrowed to a place.
   *
   * Only the collection facet narrows — a location on its own is a lens that
   * labels cards and orders them, leaving the catalogue whole (see
   * `getStorefrontProducts`). Keyed on that rather than on "a location is set",
   * because the notice and the clear button below both claim the results were
   * cut down, and saying so over a full countrywide grid is simply false.
   */
  const narrowedToPlace = Boolean(props.pickupNearby);
  const locationLabel =
    props.city || (hasCoordinates ? t("location.nearMe") : "");
  const nearbySellersLabel = t.has("location.nearbySellers")
    ? t("location.nearbySellers")
    : "Nearby sellers";
  const nearbyContextLabel = t.has("location.nearbySellersAt")
    ? t("location.nearbySellersAt", { location: locationLabel })
    : `${nearbySellersLabel} in ${locationLabel}`;
  const cityContextLabel = t.has("location.sellersIn")
    ? t("location.sellersIn", { location: locationLabel })
    : `Sellers in ${locationLabel}`;
  const browseAllLabel = t.has("location.browseAllSellers")
    ? t("location.browseAllSellers")
    : t("location.showAllLocations");

  // `distanceKm` is attached by the query layer, which is also where each
  // vendor's geo point is dropped — the point never reaches this component, let
  // alone the browser. See `lib/locations/vendor-distance.ts`.
  const cards = await applySponsoredPositions(products, props);

  /**
   * A page link that keeps the current filters.
   *
   * Built from this component's own props rather than from `useSearchParams`,
   * which a server component cannot read. The grid already receives every
   * filter it renders under, so those are exactly the params worth carrying —
   * and a param the grid ignores would not change its results anyway.
   */
  const gridQuery = {
    category: props.category,
    collection: props.collection,
    brand: props.brand,
    vendor: props.vendor,
    search: props.search,
    minPrice: props.minPrice,
    maxPrice: props.maxPrice,
    sortBy: props.sortBy,
    sortOrder: props.sortOrder,
    lat: props.lat,
    lng: props.lng,
    radius: props.radius,
    city: props.city,
    pickup: props.pickupNearby,
    preorder: props.preorder,
    extra: props.paginationParams,
  };

  const pageHref = (pageNum: number) =>
    buildProductGridPageHref(gridQuery, pageNum);

  // Built from the same object the page links use, so what "load more" fetches
  // and what page 2 would have rendered can never drift apart.
  const apiQuery = props.infinite
    ? buildProductApiQuery(gridQuery, pagination.limit)
    : "";

  if (products.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">
          {props.emptyMessage || t("productsPage.empty")}
        </p>
        {/* A location filter that returns nothing must offer the way out, not
            just report the emptiness — otherwise the store reads as having no
            stock at all when it is one narrow radius away from a full grid.
            Offered only where location did the narrowing: on an ordinary empty
            category it would blame a place that changed nothing. */}
        {narrowedToPlace ? (
          <ProductGridClearLocation
            className="mt-4"
            label={browseAllLabel}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {narrowedToPlace ? (
        <ProductGridLocationNotice
          locationLabel={hasCoordinates ? nearbyContextLabel : cityContextLabel}
          radiusLabel={
            hasCoordinates && props.radius
              ? t("location.withinKm", { km: props.radius })
              : undefined
          }
          clearLabel={browseAllLabel}
        />
      ) : null}

      {props.infinite ? (
        // Keyed on the query so a filter change starts a new run rather than
        // appending the new results under the old ones — the alternative is a
        // reset effect that has to guess which prop change meant "new grid".
        <ProductGridInfinite
          key={apiQuery}
          locale={props.locale}
          initialProducts={cards}
          initialPage={pagination.page}
          initialHasNext={pagination.page < pagination.totalPages}
          total={pagination.total}
          query={apiQuery}
          nextHref={pageHref(pagination.page + 1)}
        />
      ) : (
        <ProductGridClient
          products={cards}
          locale={props.locale}
          className={props.gridClassName}
        />
      )}

      {/* Pagination. Every link carries the filters forward: a bare `?page=2`
          drops the location, category, price and sort the shopper chose, so
          page 2 of a filtered grid silently became page 2 of the whole
          catalogue. */}
      {!props.infinite &&
        pagination.totalPages > 1 &&
        props.appearance === "electronics" && (
          <div className="mt-10 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {t("productsPage.showingCount", {
                // The organic page window; sponsored extras on page 1 are
                // additive and deliberately not counted.
                shown: `${(pagination.page - 1) * pagination.limit + 1} - ${Math.min(
                  pagination.page * pagination.limit,
                  pagination.total,
                )}`,
                total: pagination.total,
              })}
            </p>
            <ElectronicsPager
              page={pagination.page}
              totalPages={pagination.totalPages}
              pageHref={pageHref}
              previousLabel={t("common.previous")}
              nextLabel={t("common.next")}
            />
          </div>
        )}
      {!props.infinite &&
        pagination.totalPages > 1 &&
        props.appearance !== "electronics" && (
        <Pagination className="mt-8">
          <PaginationContent>
            {pagination.page > 1 && (
              <PaginationItem>
                <PaginationPrevious href={pageHref(pagination.page - 1)} />
              </PaginationItem>
            )}

            {Array.from(
              { length: Math.min(5, pagination.totalPages) },
              (_, i) => {
                const pageNum = i + 1;
                return (
                  <PaginationItem key={pageNum}>
                    <PaginationLink
                      href={pageHref(pageNum)}
                      isActive={pageNum === pagination.page}
                    >
                      {pageNum}
                    </PaginationLink>
                  </PaginationItem>
                );
              },
            )}

            {pagination.page < pagination.totalPages && (
              <PaginationItem>
                <PaginationNext href={pageHref(pagination.page + 1)} />
              </PaginationItem>
            )}
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}

/**
 * Sponsored-slot injection, page 1 only. Additive by design: organic order,
 * counts, and pagination are untouched (page 1 simply renders a few extra
 * cards), and pages 2+ from /api/products never carry sponsored items — so
 * canonical URLs and page semantics stay exactly as before. A sponsored
 * product that already sits in the organic page-1 results is badged in place
 * instead of duplicated. Category listings scope ads to their own category.
 */
async function applySponsoredPositions(
  products: ModernProduct[],
  props: ProductGridProps,
): Promise<ModernProduct[]> {
  const isFirstPage = !props.page || props.page === 1;
  if (!isFirstPage || products.length === 0) return products;
  // Contexts where a sponsored card would misrepresent the grid: a vendor's own
  // storefront shelf (another vendor's ad inside it), the curated pre-order
  // shelf, and location-narrowed grids (a sponsored card carries no locality
  // relevance and would break the "near you" claim).
  //
  // Search, brand, collection and the price facets are excluded for the same
  // reason: the ladder is global, so on those pages it would splice a phone case
  // into `?search=sofa`, a non-Nike product into `?brand=nike`, or a $900 item
  // into a grid the shopper capped at $50. An ad matching none of the active
  // facets is exactly the misrepresentation these exclusions exist to prevent.
  if (
    props.vendor ||
    props.preorder ||
    props.pickupNearby ||
    hasLocationCoordinates(props.lat, props.lng) ||
    props.city ||
    props.search ||
    props.brand ||
    props.collection ||
    props.minPrice ||
    props.maxPrice
  ) {
    return products;
  }

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

export function ProductSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <ModernProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
