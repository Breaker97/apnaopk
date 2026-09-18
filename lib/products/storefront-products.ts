import { unstable_cache } from "next/cache";
import { PRODUCT_STATUS, VENDOR_STATUS } from "@/config/app.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB, mongoose } from "@/lib/db";
import { STOREFRONT_BRAND_FILTER } from "@/lib/catalog/brands";
import { expandCategoryIdsWithDescendants } from "@/lib/catalog/categories";
import {
  getStorefrontOutOfStockDisplay,
  getStorefrontProductConstraint,
} from "@/lib/catalog/product-visibility";
import { OUT_OF_STOCK_DISPLAY } from "@/lib/catalog/catalog-display";
import { splitAvailabilityFirstPage } from "@/lib/products/availability-page";
import { productCardReplacer, PRODUCT_CARD_SELECT } from "@/lib/products/storefront-product-cards";
import { sanitizeDigitalAssetsForStorefront } from "@/lib/products/digital-assets";
import {
  buildLegacyProductSearchFilter,
  buildProductSearchFilter,
  buildProductSearchScoreExpr,
  canonicalizeProductSearch,
  matchSearchEntities,
  parseProductSearch,
  type ParsedProductSearch,
} from "@/lib/products/search";
import { getProductSearchEntityIndex } from "@/lib/products/search-entities";
import {
  correctProductSearch,
  type SearchCorrection,
} from "@/lib/products/search-typo";
import { getSearchVocabulary } from "@/lib/products/search-vocabulary";
import {
  getProductSearchCoverage,
  scheduleProductSearchIndexHeal,
} from "@/lib/products/search-index";
import { findNearbyVendors } from "@/lib/locations/nearby-vendors";
import {
  collectableAtBranchesQuery,
  stripLocationInventory,
} from "@/lib/inventory/pickup-branch-stock";
import {
  PICKUP_NEARBY_PARAM,
  normalizeDistanceSortForLocation,
} from "@/lib/locations/shopper-location";
import {
  cacheGridCoordinate,
  isUsableLatLng,
  normalizeRadiusKm,
} from "@/lib/locations/vendor-geo";
import {
  type CollectNearbySet,
  type VendorDistanceMap,
  intersectLocationVendorIds,
  withVendorDistance,
} from "@/lib/locations/vendor-distance";
import {
  AVAILABLE_STOCK_EXPR,
  AVAILABLE_STOCK_QUERY,
  UNAVAILABLE_STOCK_QUERY,
  withStockConstraint,
} from "@/lib/products/stock-policy";
import { Brand, Category, Collection, Product, Vendor } from "@/models";

/**
 * `PRODUCT_CARD_SELECT` as an aggregation `$project`.
 *
 * The distance sort runs through an aggregation, which does not inherit the
 * `.select()` applied to the equivalent `find()`. Deriving both shapes from the
 * one field list is what keeps them from drifting — a field added to the card
 * select but missed here would render an empty value only on distance-sorted
 * grids, which is the kind of gap nobody reproduces by accident.
 */
const PRODUCT_CARD_PROJECTION: Record<string, 1> = Object.fromEntries(
  PRODUCT_CARD_SELECT.split(" ")
    .filter(Boolean)
    .map((field) => [field, 1 as const]),
);

type StorefrontProductsQuery = {
  page?: number | string | null;
  limit?: number | string | null;
  vendor?: string | null;
  tag?: string | null;
  search?: string | null;
  minPrice?: number | string | null;
  maxPrice?: number | string | null;
  status?: string | null;
  featured?: boolean | string | null;
  preorder?: boolean | string | null;
  sortBy?: string | null;
  sortOrder?: string | null;
  category?: string | string[] | null;
  collection?: string | string[] | null;
  brand?: string | string[] | null;
  onSale?: boolean | string | null;
  ids?: string | string[] | null;
  minRating?: number | string | null;
  inStock?: boolean | string | null;
  outOfStock?: boolean | string | null;
  /**
   * When true, only the fields needed to render a product card are fetched
   * (see PRODUCT_CARD_SELECT). Storefront grids set this to avoid pulling the
   * full document (description, seo, shipping, etc.). The public API leaves it
   * off so its response contract stays complete.
   */
  cardFieldsOnly?: boolean | null;
  /**
   * Shopper's location. A product has no location of its own — it is where its
   * vendor is — so these resolve to a vendor id set before the product query
   * runs (see `lib/locations/nearby-vendors.ts`).
   *
   * `lat`/`lng` drive radius search; `city` both names the place and reaches
   * vendors whose address never geocoded. Either may be supplied alone.
   */
  lat?: number | string | null;
  lng?: number | string | null;
  /** Kilometres. Absent or 0 means everywhere — no distance constraint. */
  radius?: number | string | null;
  city?: string | null;
  /**
   * Narrow to products a shopper could collect in person, from a merchant with
   * an active collection point inside their radius.
   *
   * A discovery facet, not a checkout guarantee: it answers "is there a counter
   * near me holding this seller's goods", which is the question a shopper is
   * actually asking when they browse for pickup. Off is the default and is
   * expressed by the param being absent entirely — never `pickup=all` — so a
   * shared link carries no dead parameter and the cache gains no dimension.
   */
  pickupNearby?: boolean | string | null;
};

type StorefrontProductsResult<T = unknown> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  /**
   * Set when a misspelt search was answered with corrected words: the
   * shopper typed `from` and is looking at results for `to`. Absent when the
   * search matched as typed.
   */
  searchCorrection?: { from: string; to: string };
};

/** @public — reached by tests through a dynamic import, which knip cannot follow. */
export { intersectLocationVendorIds } from "@/lib/locations/vendor-distance";

type NormalizedStorefrontProductsQuery = {
  page: number;
  limit: number;
  vendor?: string;
  tag?: string;
  /** Canonical form (`canonicalizeProductSearch`), so it doubles as the cache key. */
  search?: string;
  minPrice?: string;
  maxPrice?: string;
  status: string;
  featured?: boolean;
  preorder?: boolean;
  sortBy: string;
  sortOrder?: string;
  categoryValues: string[];
  collectionValues: string[];
  brandValues: string[];
  onSale?: boolean;
  ids?: string[];
  minRating?: string;
  inStock?: boolean;
  outOfStock?: boolean;
  cardFieldsOnly: boolean;
  /**
   * Rounded onto a shared ~1 km grid. This object *is* the cache key, so a raw
   * GPS coordinate here would mint a fresh cache entry per shopper and defeat
   * the cache entirely; neighbours must collapse onto one entry.
   */
  lat?: number;
  lng?: number;
  radiusKm?: number;
  city?: string;
  /**
   * `undefined` when off, never `false`. An always-present key would add a
   * constant to every cache entry, and — worse — split the cache the moment one
   * call site passes `false` while another omits it. `product-filters-with-count`
   * deliberately reuses the grid's entry, so the two must serialize identically.
   */
  pickupNearby?: boolean;
};

function buildPreorderExpression(now: Date) {
  const preorderOpenExpr = (path: string) => ({
    $and: [
      { $eq: [`$${path}.enabled`, true] },
      {
        $or: [
          { $eq: [`$${path}.autoConvert`, false] },
          { $eq: [{ $ifNull: [`$${path}.releaseDate`, null] }, null] },
          { $gte: [`$${path}.releaseDate`, now] },
        ],
      },
      {
        $or: [
          { $lte: [{ $ifNull: [`$${path}.limit`, 0] }, 0] },
          {
            $lt: [
              { $ifNull: [`$${path}.reservedQuantity`, 0] },
              { $ifNull: [`$${path}.limit`, 0] },
            ],
          },
        ],
      },
    ],
  });

  const variantPreorderOpenExpr = {
    $anyElementTrue: {
      $map: {
        input: { $ifNull: ["$variants", []] },
        as: "variant",
        in: {
          $and: [
            { $eq: ["$$variant.preorder.enabled", true] },
            {
              $or: [
                { $eq: ["$$variant.preorder.autoConvert", false] },
                {
                  $eq: [
                    { $ifNull: ["$$variant.preorder.releaseDate", null] },
                    null,
                  ],
                },
                { $gte: ["$$variant.preorder.releaseDate", now] },
              ],
            },
            {
              $or: [
                {
                  $lte: [
                    { $ifNull: ["$$variant.preorder.limit", 0] },
                    0,
                  ],
                },
                {
                  $lt: [
                    {
                      $ifNull: ["$$variant.preorder.reservedQuantity", 0],
                    },
                    { $ifNull: ["$$variant.preorder.limit", 0] },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  };

  return {
    $or: [preorderOpenExpr("preorder"), variantPreorderOpenExpr],
  };
}

function parsePositiveInteger(
  value: number | string | null | undefined,
  fallback: number,
) {
  const parsed =
    typeof value === "number" ? value : parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeBoolean(value: boolean | string | null | undefined) {
  return value === true || value === "true";
}

/**
 * The value the "Pickup near me" control actually writes.
 *
 * Deliberately NOT `normalizeBoolean`. The URL carries `?pickup=nearby` — a
 * token naming the mode, which is what a shopper sees and shares — and
 * `normalizeBoolean` accepts only `"true"`, so routing this through it turned
 * the whole facet into a silent no-op: the button rendered as selected, the
 * mobile badge counted it, and the query underneath was byte-identical to
 * "All sellers".
 *
 * Anything else, including `?pickup=false` or a stale `?pickup=1` from some
 * future rename, means off. An unrecognised token must not enable a filter.
 */
export function normalizePickupFacet(
  value: boolean | string | null | undefined,
): true | undefined {
  return value === true || value === PICKUP_NEARBY_PARAM ? true : undefined;
}

function normalizeOptionalString(value: number | string | null | undefined) {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function normalizeValues(value: string | string[] | null | undefined) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Furthest offset any listing will seek to.
 *
 * `?page=` is anonymous and was unbounded, and the query runs `.skip(n)`: a
 * single request for `?page=10000000` asked MongoDB to walk 120 million index
 * entries before returning twelve products. That is the same cheap-DoS shape
 * the `limit` clamp below closes, and it also bounds the cache — an unbounded
 * page number mints an unbounded number of distinct `unstable_cache` entries.
 *
 * 10,000 is far beyond hand-browsing (page 834 at the default 12 per page) and
 * still bounded work per request. Deeper catalogues are reached by filtering or
 * sorting, not by paging; a request past the cap is clamped back to the last
 * reachable page rather than returning a blank grid.
 */
const MAX_PRODUCT_SKIP = 10_000;

function normalizeQuery(
  query: StorefrontProductsQuery = {},
): NormalizedStorefrontProductsQuery {
  const ids =
    query.ids === null || query.ids === undefined
      ? undefined
      : normalizeValues(query.ids);

  // Clamp the page size. Without an upper bound, `?limit=100000` would fetch
  // and serialize the whole catalog per request (and mint a distinct cache
  // entry per value) — a cheap DoS on an anonymous endpoint.
  const limit = Math.min(100, parsePositiveInteger(query.limit, 12));

  return {
    page: Math.min(
      parsePositiveInteger(query.page, 1),
      Math.floor(MAX_PRODUCT_SKIP / limit) + 1,
    ),
    limit,
    vendor: normalizeOptionalString(query.vendor),
    tag: normalizeOptionalString(query.tag),
    search: canonicalizeProductSearch(query.search) || undefined,
    minPrice: normalizeOptionalString(query.minPrice),
    maxPrice: normalizeOptionalString(query.maxPrice),
    // Storefront is ACTIVE-only. Never trust a client-supplied status: allowing
    // `?status=draft` would leak unreleased products with full pricing/SKUs.
    status: PRODUCT_STATUS.ACTIVE,
    featured: normalizeBoolean(query.featured) || undefined,
    preorder: normalizeBoolean(query.preorder) || undefined,
    sortBy: normalizeSort(query),
    sortOrder: normalizeOptionalString(query.sortOrder),
    categoryValues: normalizeValues(query.category),
    collectionValues: normalizeValues(query.collection),
    brandValues: normalizeValues(query.brand),
    onSale: normalizeBoolean(query.onSale) || undefined,
    ids,
    minRating: normalizeOptionalString(query.minRating),
    inStock: normalizeBoolean(query.inStock) || undefined,
    outOfStock: normalizeBoolean(query.outOfStock) || undefined,
    cardFieldsOnly: normalizeBoolean(query.cardFieldsOnly),
    // A sibling of the location, not part of it: `normalizeLocation` returns
    // early when the point is unusable, which would silently swallow the facet
    // and turn "collect near me" into an unfiltered grid.
    pickupNearby: normalizePickupFacet(query.pickupNearby),
    ...normalizeLocation(query),
  };
}

/**
 * The order a query asked for, or the default when it asked for none.
 *
 * The default depends on the query: a search is ordered by how well each
 * product matches ("relevance"), anything else newest first. A distance sort
 * with no location to measure from falls to that default too, rather than to
 * a fixed "newest" that would throw a search's ranking away.
 */
function normalizeSort(query: StorefrontProductsQuery): string {
  const requested = normalizeOptionalString(query.sortBy);
  const located = normalizeDistanceSortForLocation(requested, query.lat, query.lng);
  const usable = requested === "distance" && located !== "distance" ? undefined : located;
  if (usable) return usable;
  return canonicalizeProductSearch(query.search) ? "relevance" : "createdAt";
}

/**
 * Normalize the shopper's location for use as part of the cache key.
 *
 * A coordinate pair is only kept when both halves are usable — a half-supplied
 * point (a truncated URL, a failed geolocation read) would otherwise be treated
 * as a location and silently filter the catalogue against a meaningless origin.
 */
function normalizeLocation(query: StorefrontProductsQuery) {
  const city = normalizeOptionalString(query.city);
  const rawLat = query.lat === null || query.lat === undefined ? NaN : Number(query.lat);
  const rawLng = query.lng === null || query.lng === undefined ? NaN : Number(query.lng);

  if (!isUsableLatLng(rawLat, rawLng)) {
    return { city };
  }

  return {
    lat: cacheGridCoordinate(rawLat),
    lng: cacheGridCoordinate(rawLng),
    // Snapped to an offered step so a hand-edited `?radius=37` cannot mint its
    // own cache entry. `null` (everywhere) drops the constraint entirely.
    radiusKm: normalizeRadiusKm(query.radius) ?? undefined,
    city,
  };
}

/** Once every five minutes per process, not on every uncached search. */
const SEARCH_INDEX_WARNING_INTERVAL_MS = 5 * 60_000;
let searchIndexWarnedAt = 0;

/** Relevance ranking's tiebreakers: the "popular" order. */
const RELEVANCE_TIEBREAK_SORT: Record<string, 1 | -1> = {
  reviewCount: -1,
  rating: -1,
  createdAt: -1,
};

type ResolvedProductSearch = {
  /** Appended to the query's `$and`. */
  clauses: Record<string, unknown>[];
  /** The relevance expression, or null when there is no index to rank by. */
  score: Record<string, unknown> | null;
  /** Present when the answer is for corrected words. */
  correction?: SearchCorrection;
};

/**
 * Matches no document, and costs nothing: an empty `$in` on `_id` gives the
 * planner empty index bounds, so the page query and its count return at
 * once. Used when the search stages have already proved there is nothing to
 * find, so the grid query does not scan the catalogue a second time to learn
 * the same thing.
 */
const MATCHES_NOTHING: Record<string, unknown> = { _id: { $in: [] } };

/**
 * The filter for a search, decided against the catalogue it will run on.
 *
 * Every decision is measured against the base visibility filter, not the
 * shopper's other facets, so paging and filtering never flip it. In order,
 * the first stage that finds anything answers:
 *
 * 1. **Precise.** Every group prefix-matches an indexed term, or names a
 *    category or brand.
 * 2. **Descriptions.** The same words anywhere in a product's text. Before
 *    any correction on purpose: a word the catalogue really contains, if
 *    only in a description, is never "corrected" into a different one.
 * 3. **Corrected.** The words that match nothing in the catalogue are
 *    swapped for their nearest real words ("ipone" → "iphone"), and stages 1
 *    and 2 run again. The caller is told, so the page can say what it is
 *    showing.
 *
 * A store whose index was never built (the migration was skipped) gets the
 * unindexed substring search over the primary fields, with a log line saying
 * so, rather than an empty grid.
 */
async function resolveProductSearch(
  parsed: ParsedProductSearch,
  baseFilter: Record<string, unknown>,
): Promise<ResolvedProductSearch> {
  const coverage = await getProductSearchCoverage();
  if (coverage.total > 0 && coverage.indexed === 0) {
    const now = Date.now();
    if (now - searchIndexWarnedAt > SEARCH_INDEX_WARNING_INTERVAL_MS) {
      searchIndexWarnedAt = now;
      console.error(
        "[product-search] No product carries a search index yet; answering with the unindexed substring search. Run `pnpm db:migrate product-search`.",
      );
    }
    return { clauses: buildLegacyProductSearchFilter(parsed), score: null };
  }

  const entityIndex = await getProductSearchEntityIndex();
  const matches = (clauses: Record<string, unknown>[]) =>
    Product.exists({ ...baseFilter, $and: clauses });

  const entities = matchSearchEntities(parsed, entityIndex);
  const score = buildProductSearchScoreExpr(parsed, entities);
  const precise = buildProductSearchFilter(parsed, entities, "terms");
  if (await matches(precise)) return { clauses: precise, score };

  const text = buildProductSearchFilter(parsed, entities, "text");
  if (await matches(text)) return { clauses: text, score };

  const corrected = correctProductSearch(parsed, await getSearchVocabulary());
  if (corrected) {
    const fixedEntities = matchSearchEntities(corrected.parsed, entityIndex);
    const fixedScore = buildProductSearchScoreExpr(corrected.parsed, fixedEntities);
    for (const stage of ["terms", "text"] as const) {
      const clauses = buildProductSearchFilter(corrected.parsed, fixedEntities, stage);
      if (await matches(clauses)) {
        return { clauses, score: fixedScore, correction: corrected.correction };
      }
    }
  }

  return { clauses: [MATCHES_NOTHING], score: null };
}

/** Sorts a shopper chose on purpose; anything else is the grid's default order. */
function buildSort(
  query: NormalizedStorefrontProductsQuery,
): Record<string, 1 | -1> {
  const sort: Record<string, 1 | -1> = {};

  // Marker rather than a real field: distance lives in the resolved vendor
  // order, not on the product, so the caller swaps this for a vendor-rank sort.
  // It is dropped when there is no location to measure from, which leaves the
  // fallback below to order the grid.
  if (query.sortBy === "distance") {
    sort.__distance = 1;
    sort.createdAt = -1;
    return sort;
  }

  if (query.sortBy === "price-asc") sort.price = 1;
  else if (query.sortBy === "price-desc") sort.price = -1;
  else if (query.sortBy === "rating") {
    sort.rating = -1;
    sort.reviewCount = -1;
  } else if (query.sortBy === "popular") {
    sort.reviewCount = -1;
    sort.rating = -1;
    sort.createdAt = -1;
  } else if (query.sortBy === "preorder-release") {
    sort["preorder.releaseDate"] = query.sortOrder === "desc" ? -1 : 1;
    sort.createdAt = -1;
  } else if (query.sortBy === "preorder-reserved") {
    sort["preorder.reservedQuantity"] = -1;
    sort.createdAt = -1;
  } else if (query.sortBy === "price") {
    sort.price = query.sortOrder === "asc" ? 1 : -1;
  } else if (query.sortBy === "createdAt") {
    sort.createdAt = query.sortOrder === "asc" ? 1 : -1;
  } else {
    // "relevance" lands here too: its real order is the match score the
    // search adds, and this is what orders a relevance request that carries
    // no search (a hand-edited URL) — the same newest-first default.
    sort.createdAt = -1;
  }

  return sort;
}

function emptyResult<T = unknown>(
  page: number,
  limit: number,
): StorefrontProductsResult<T> {
  return {
    data: [],
    pagination: {
      page,
      limit,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: page > 1,
    },
  };
}

/**
 * Serialize a result for the caller, labelling each card with its vendor's
 * collection distance and dropping any coordinate that rode along.
 *
 * The distance comes from the location resolver, which measured it from the
 * merchant's nearest collection point. Both steps happen here, at the one place
 * every caller — the grid, the public API, the AI tools — passes through,
 * rather than at each call site where a single omission republishes a vendor's
 * exact position. `lib/locations/vendor-distance.ts` explains why that is a
 * privacy breach and not just noise.
 */
function serializeResult<T>(
  result: StorefrontProductsResult<T>,
  distances: VendorDistanceMap | null = null,
  collectNearby: CollectNearbySet | null = null,
  cardFieldsOnly = false,
): StorefrontProductsResult<T> {
  // Card responses trim each variant to what a card renders, in the same
  // pass that makes the payload JSON-safe (see `productCardReplacer`).
  const serialized = JSON.parse(
    JSON.stringify(result, cardFieldsOnly ? productCardReplacer : undefined),
  ) as StorefrontProductsResult<T>;

  serialized.data = serialized.data.map(
    (product) =>
      withVendorDistance(product as never, distances, collectNearby) as T,
  );

  return serialized;
}

function splitObjectIdsAndSlugs(values: string[]) {
  const ids: string[] = [];
  const slugs: string[] = [];

  for (const value of values) {
    if (mongoose.isValidObjectId(value)) {
      ids.push(value);
    } else {
      slugs.push(value.toLowerCase());
    }
  }

  return { ids, slugs };
}

/**
 * Hex strings as real ObjectIds, for a filter that may end up in an aggregation.
 *
 * `Product.find()` casts these itself, so leaving them as strings works — right
 * up until the distance sort routes the SAME `mongoQuery` through
 * `Product.aggregate([{ $match: ... }])`, where `$match` compares raw BSON and
 * a string never equals an ObjectId. The filter then silently matches nothing:
 * `?category=shoes&sortBy=distance` returned an empty grid while
 * `?category=shoes` returned a full one. `vendorId` was already cast for this
 * exact reason; every other id-valued filter needs the same treatment.
 */
function toObjectIds(values: string[]) {
  return values.map((value) => new mongoose.Types.ObjectId(value));
}

/**
 * A product carries exactly one category, so filtering on a parent alone
 * returns nothing when the products sit on its children — which is where they
 * belong once the catalog is nested. Every category therefore stands for its
 * whole branch, so all three navigation levels open a real grid.
 */
async function resolveCategoryIds(values: string[]) {
  const { ids, slugs } = splitObjectIdsAndSlugs(values);
  const docs =
    slugs.length > 0
      ? await Category.find({ slug: { $in: slugs } }).select("_id").lean()
      : [];

  return expandCategoryIdsWithDescendants([
    ...ids,
    ...docs.map((doc) => String(doc._id)),
  ]);
}

async function resolveCollectionIds(values: string[]) {
  const { ids, slugs } = splitObjectIdsAndSlugs(values);
  const docs =
    slugs.length > 0
      ? await Collection.find({ slug: { $in: slugs }, status: "active" })
          .select("_id")
          .lean()
      : [];

  return [...ids, ...docs.map((doc) => String(doc._id))];
}

async function resolveBrandIds(values: string[]) {
  const { ids, slugs } = splitObjectIdsAndSlugs(values);
  const docs =
    slugs.length > 0
      ? await Brand.find({ slug: { $in: slugs }, ...STOREFRONT_BRAND_FILTER })
          .select("_id")
          .lean()
      : [];

  return [...ids, ...docs.map((doc) => String(doc._id))];
}

const getStorefrontProductsCached = unstable_cache(
  async (
    query: NormalizedStorefrontProductsQuery,
  ): Promise<StorefrontProductsResult> => {
    await connectDB();

    const skip = (query.page - 1) * query.limit;
    const sort = buildSort(query);
    const visibility = await getStorefrontProductConstraint();
    const mongoQuery: Record<string, unknown> = {
      status: query.status,
      ...visibility,
    };

    if (query.categoryValues.length > 0) {
      const categoryIds = await resolveCategoryIds(query.categoryValues);

      if (categoryIds.length === 0) {
        return emptyResult(query.page, query.limit);
      }

      mongoQuery.category = { $in: toObjectIds(categoryIds) };
    }

    if (query.collectionValues.length > 0) {
      const collectionIds = await resolveCollectionIds(query.collectionValues);

      if (collectionIds.length === 0) {
        return emptyResult(query.page, query.limit);
      }

      mongoQuery.collectionIds = { $in: toObjectIds(collectionIds) };
    }

    if (query.brandValues.length > 0) {
      const brandIds = await resolveBrandIds(query.brandValues);

      if (brandIds.length === 0) {
        return emptyResult(query.page, query.limit);
      }

      mongoQuery.brand = { $in: toObjectIds(brandIds) };
    }

    if (query.vendor) {
      // storeActive $ne:false hides a deactivated store's product listing too.
      const vendorQuery = mongoose.isValidObjectId(query.vendor)
        ? {
            _id: query.vendor,
            status: VENDOR_STATUS.APPROVED,
            storeActive: { $ne: false },
          }
        : {
            slug: query.vendor.toLowerCase(),
            status: VENDOR_STATUS.APPROVED,
            storeActive: { $ne: false },
          };

      const vendorDoc = await Vendor.findOne(vendorQuery).select("_id").lean();

      if (!vendorDoc) {
        return emptyResult(query.page, query.limit);
      }

      mongoQuery.vendorId = vendorDoc._id;
    }

    // Location. Products carry no location of their own — a product is where
    // its vendor is — so a shopper's location resolves to vendor ids, which are
    // then used in one of two ways.
    //
    // **A location on its own is a lens, not a filter.** It labels cards with a
    // distance and a "collect nearby" badge, and it can order the grid nearest
    // first, but it removes nothing. Narrowing on it meant a shopper who set
    // "Dhaka, 20 km" to see what they could collect also lost every deliverable
    // product in the rest of the country — which is the single biggest way this
    // feature made a fully stocked store look empty, and it punished exactly the
    // merchants whose branches were never geocoded.
    //
    // "Pickup near me" is the one control that narrows, because collection is
    // the one promise a far-away vendor genuinely cannot keep.
    //
    // Held separately for the distance sort either way: `$in` does not preserve
    // order, so the nearest-first sequence cannot ride on the query.
    let nearbyVendorOrder: string[] | null = null;

    // Each card's "12 km away", already measured by the resolver from the
    // merchant's nearest collection point. Empty when the shopper gave only a
    // city name — there is nothing to measure from, and a made-up distance is
    // worse than none.
    const vendorDistances: VendorDistanceMap = new Map();

    // Vendors reached through an actual collection point, as opposed to a city
    // name. Drives the card badge, and is the reason `via` exists.
    const collectNearbyVendors = new Set<string>();

    if (query.pickupNearby) {
      // A digital product is never collected, whatever the seller's counter
      // says — `resolvePickupEligibility` answers `digital_only` for a cart of
      // them. Excluding them here is what keeps the facet from labelling an
      // ebook "collect nearby" and sending the shopper to a checkout that
      // offers no pickup at all.
      mongoQuery["shipping.isPhysicalProduct"] = { $ne: false };
    }

    if (query.lat !== undefined || query.city || query.pickupNearby) {
      const nearby = await findNearbyVendors({
        center:
          query.lat !== undefined && query.lng !== undefined
            ? { lat: query.lat, lng: query.lng }
            : null,
        radiusKm: query.radiusKm ?? null,
        city: query.city ?? null,
        requirePickupBranch: query.pickupNearby,
      });

      // `unfiltered` means there was nothing to act on; leaving `vendorId`
      // alone shows the full catalogue rather than emptying it.
      if (!nearby.unfiltered) {
        if (query.pickupNearby) {
          // The narrowing pass, and the only one. An empty answer here is a
          // real "nothing is collectable near you", not a missing signal.
          if (nearby.vendorIds.length === 0) {
            return emptyResult(query.page, query.limit);
          }

          // `vendorId` is never free here: the storefront visibility constraint
          // has already pinned it to the approved-vendor set, and a vendor page
          // narrows it further to one id. Both must survive, so this intersects
          // rather than assigns — overwriting would silently republish
          // suspended vendors' products to anyone who set a location.
          const inRange = intersectLocationVendorIds(
            mongoQuery.vendorId,
            nearby.vendorIds,
          );

          if (inRange.length === 0) {
            return emptyResult(query.page, query.limit);
          }

          // Cast to ObjectId rather than left as hex strings. `find()` casts
          // these itself, but the aggregation used by the distance sort does
          // not — `$match` compares raw values, so strings would match nothing
          // and silently empty the grid. Same reasoning as
          // `getStorefrontProductConstraint()`.
          mongoQuery.vendorId = {
            $in: inRange.map((id) => new mongoose.Types.ObjectId(id)),
          };
          nearbyVendorOrder = inRange;

          // The vendor constraint above only says "this seller has a counter
          // near you". What the facet promises is "this ITEM is at a counter
          // near you", and a vendor's stock is the sum across every branch they
          // run — including the ones on the other side of the country. Without
          // this, a shopper filtering for collection was shown items whose only
          // units sat in a warehouse they could never walk into, and only found
          // out at the counter.
          //
          // Pushed into `$and` because `$or` at the top level is already spoken
          // for by other facets. The rule itself, and why a merchant who never
          // used locations still passes it, is in `lib/pickup-branch-stock.ts`.
          if (nearby.branchIds.length > 0) {
            mongoQuery.$and = [
              ...((mongoQuery.$and as Record<string, unknown>[]) || []),
              collectableAtBranchesQuery(nearby.branchIds),
            ];
          }
        } else {
          // Lens: the grid keeps every product it already had. These ids are
          // only a rank list for the distance sort, so they need no permission
          // intersection — naming a vendor the query cannot return simply means
          // no product ever carries that rank.
          nearbyVendorOrder = nearby.vendorIds;
        }

        for (const match of nearby.matches) {
          // Absent for a city match, and for a vendor who publishes no address
          // — the resolver decides both, and neither gets a number here.
          if (match.distanceKm !== undefined) {
            vendorDistances.set(match.vendorId, match.distanceKm);
          }

          // Keyed on `via`, deliberately not on `distanceKm`: a vendor who
          // hides their address gets no distance but does still have a counter
          // nearby, and "you can collect this near you" is a different, milder
          // disclosure than "the seller is 2.3 km away".
          if (match.via === "radius") {
            collectNearbyVendors.add(match.vendorId);
          }
        }
      }
    }

    if (query.tag) {
      mongoQuery.tags = query.tag;
    }

    // Search. Null for input that is nothing but separators, which leaves the
    // grid unfiltered rather than empty.
    const parsedSearch = query.search ? parseProductSearch(query.search) : null;
    let relevanceScore: Record<string, unknown> | null = null;
    let searchCorrection: StorefrontProductsResult["searchCorrection"];
    if (parsedSearch) {
      const resolved = await resolveProductSearch(parsedSearch, {
        status: query.status,
        ...visibility,
      });
      mongoQuery.$and = [
        ...((mongoQuery.$and as Record<string, unknown>[]) || []),
        ...resolved.clauses,
      ];
      // Ranked by match quality only under the "relevance" order — a search's
      // default. A shopper who picks "Newest" or a price order gets exactly
      // that, over the same matching products.
      if (query.sortBy === "relevance") relevanceScore = resolved.score;
      if (resolved.correction) {
        searchCorrection = {
          from: resolved.correction.from,
          to: resolved.correction.to,
        };
      }
    }

    if (query.minPrice || query.maxPrice) {
      const parsedMinPrice = query.minPrice
        ? parseFloat(query.minPrice)
        : undefined;
      const parsedMaxPrice = query.maxPrice
        ? parseFloat(query.maxPrice)
        : undefined;
      const productPriceCondition: Record<string, number> = {};
      const variantPriceCondition: Record<string, number> = {};

      if (
        typeof parsedMinPrice === "number" &&
        Number.isFinite(parsedMinPrice)
      ) {
        productPriceCondition.$gte = parsedMinPrice;
        variantPriceCondition.$gte = parsedMinPrice;
      }
      if (
        typeof parsedMaxPrice === "number" &&
        Number.isFinite(parsedMaxPrice)
      ) {
        productPriceCondition.$lte = parsedMaxPrice;
        variantPriceCondition.$lte = parsedMaxPrice;
      }

      if (Object.keys(productPriceCondition).length > 0) {
        mongoQuery.$and = [
          ...((mongoQuery.$and as Record<string, unknown>[]) || []),
          {
            $or: [
              { variants: { $elemMatch: { price: variantPriceCondition } } },
              {
                $and: [
                  {
                    $or: [
                      { variants: { $exists: false } },
                      { variants: { $size: 0 } },
                    ],
                  },
                  { price: productPriceCondition },
                ],
              },
            ],
          },
        ];
      }
    }

    if (query.featured) {
      mongoQuery.featured = true;
    }

    if (query.preorder) {
      mongoQuery.$and = [
        ...((mongoQuery.$and as Record<string, unknown>[]) || []),
        { $expr: buildPreorderExpression(new Date()) },
      ];
    }

    if (query.onSale) {
      mongoQuery.$and = [
        ...((mongoQuery.$and as Record<string, unknown>[]) || []),
        {
          $expr: {
            $or: [
              { $gt: ["$comparePrice", "$price"] },
              {
                $anyElementTrue: {
                  $map: {
                    input: { $ifNull: ["$variants", []] },
                    as: "v",
                    in: { $gt: ["$$v.comparePrice", "$$v.price"] },
                  },
                },
              },
            ],
          },
        },
      ];
    }

    if (query.ids !== undefined) {
      const ids = query.ids.filter((value) => mongoose.isValidObjectId(value));

      if (ids.length === 0) {
        return emptyResult(query.page, query.limit);
      }

      mongoQuery._id = { $in: toObjectIds(ids) };
    }

    if (query.minRating) {
      mongoQuery.rating = { $gte: parseFloat(query.minRating) };
    }

    // Both flags together select everything, so they cancel rather than
    // compound into an empty grid.
    if (query.inStock && !query.outOfStock) {
      // Not simply `stock > 0`: a digital or untracked product is always
      // buyable, so hiding it here would contradict its own buy box. Pushed
      // into $and because $or is already spoken for by other facets.
      mongoQuery.$and = [
        ...((mongoQuery.$and as Record<string, unknown>[]) || []),
        AVAILABLE_STOCK_QUERY,
      ];
    } else if (query.outOfStock && !query.inStock) {
      // The exact complement of the in-stock facet, so the two partitions
      // always sum to the unfiltered grid.
      mongoQuery.$and = [
        ...((mongoQuery.$and as Record<string, unknown>[]) || []),
        UNAVAILABLE_STOCK_QUERY,
      ];
    }

    // The platform's own policy, applied after the shopper's facets rather than
    // instead of them. `hide` takes the products out of the catalogue outright,
    // so `?outOfStock=true` against a hidden catalogue correctly returns an
    // empty grid instead of overriding the admin.
    const outOfStockDisplay = await getStorefrontOutOfStockDisplay();

    if (outOfStockDisplay === OUT_OF_STOCK_DISPLAY.HIDE) {
      mongoQuery.$and = [
        ...((mongoQuery.$and as Record<string, unknown>[]) || []),
        AVAILABLE_STOCK_QUERY,
      ];
    }

    // An ordering, not a filter: `total` and the page count are the same as
    // they would be under `show`, only the page a product lands on changes.
    const sortOutOfStockLast = outOfStockDisplay === OUT_OF_STOCK_DISPLAY.LAST;

    // A builder rather than one query object: the availability-first page below
    // needs two of these over different filters, and they must carry the same
    // projection and populates or the two halves of a grid would render
    // differently.
    const buildProductsQuery = (filter: Record<string, unknown>) => {
      const productsQuery = Product.find(filter)
        // `address.city` rides along so a location-filtered card can say where
        // it ships from. One extra string field on a query that already loads
        // the vendor — no additional lookup. `address.geo` is deliberately NOT
        // selected: distance now comes from the collection point the resolver
        // matched, so loading the vendor's own coordinate would only widen the
        // surface `withVendorDistance` has to strip.
        .populate(
          "vendorId",
          "storeName slug logo address.city storeVisibility.addressDisplay",
        )
        .populate("category", "name slug");

      if (query.cardFieldsOnly) {
        // Card grids never render brand, so we both skip the projection field
        // and the populate. (Populating an unselected path makes Mongoose
        // re-add it to the projection and still run the brand lookup —
        // wasteful here.)
        productsQuery.select(PRODUCT_CARD_SELECT);
      } else {
        // The derived search block is an implementation detail — not part of
        // the public API's product shape, and a few KB per document.
        productsQuery.select("-search").populate("brand", "name slug logo");
      }

      return productsQuery;
    };

    // Distance sort cannot be expressed as a field sort — the ordering lives in
    // the vendor list, not on the product. Mongo is given the vendor's rank
    // (nearest first) as a computed field so paging still happens in the
    // database; sorting the page in memory would order each page against itself
    // and interleave distances across page boundaries.
    // Always cleared before the sort reaches Mongo: `__distance` is a marker,
    // and a shopper asking to sort by distance with no location set (a shared
    // link, a cleared location) must fall back to the secondary sort rather
    // than order the grid by a field no product has.
    const sortByDistance = Boolean(sort.__distance);
    delete sort.__distance;

    // `.length`, not just presence: as a lens the resolver can answer "nobody is
    // near you" without emptying the grid, and ranking against an empty list
    // gives every product the same rank — the aggregation would then do a
    // blocking in-memory sort to reproduce exactly what the indexed `find()`
    // below returns for free.
    // A ranked search takes the same road: its score only exists inside an
    // aggregation, and paging has to happen after the sort that uses it.
    const rankByDistance = Boolean(nearbyVendorOrder?.length && sortByDistance);
    if (rankByDistance || relevanceScore) {
      const [products, total] = await Promise.all([
        Product.aggregate([
          { $match: mongoQuery },
          {
            $addFields: {
              // 0 for a product that can be bought, 1 for one that cannot, so
              // an ascending sort puts the unavailable ones last. This branch
              // already pays for a computed sort, so folding availability into
              // it costs nothing extra — which is why the indexed `find()` path
              // below has to solve the same problem a different way.
              ...(sortOutOfStockLast
                ? { __unavailable: { $cond: [AVAILABLE_STOCK_EXPR, 0, 1] } }
                : {}),
              ...(rankByDistance
                ? {
                    __vendorRank: {
                      $let: {
                        vars: {
                          rank: {
                            $indexOfArray: [
                              (nearbyVendorOrder as string[]).map(
                                (id) => new mongoose.Types.ObjectId(id),
                              ),
                              "$vendorId",
                            ],
                          },
                        },
                        // `$indexOfArray` answers -1 for a vendor that is not
                        // in the nearby list, and -1 sorts ahead of 0 — which
                        // would put every distant store at the TOP of a
                        // nearest-first grid. Unreachable while the location
                        // narrowed the query (every vendor was in the list by
                        // construction); reachable the moment location became
                        // a lens, which is what this guards.
                        in: {
                          $cond: [
                            { $eq: ["$$rank", -1] },
                            Number.MAX_SAFE_INTEGER,
                            "$$rank",
                          ],
                        },
                      },
                    },
                  }
                : {}),
              ...(relevanceScore ? { __score: relevanceScore } : {}),
            },
          },
          // Availability outranks distance and relevance deliberately: "out of
          // stock last" means last, and a sold-out product two streets away —
          // or the best match for the words typed — is still one a shopper
          // cannot buy. Ties fall back to the secondary sort so a store's own
          // products keep a stable, meaningful order; for a ranked search that
          // is the "popular" order, the most useful tiebreak between products
          // that match equally well.
          {
            $sort: {
              ...(sortOutOfStockLast ? { __unavailable: 1 as const } : {}),
              ...(rankByDistance ? { __vendorRank: 1 as const } : {}),
              ...(relevanceScore
                ? { __score: -1 as const, ...RELEVANCE_TIEBREAK_SORT }
                : sort),
            },
          },
          { $skip: skip },
          { $limit: query.limit },
          // The aggregation has to reproduce the projection `productsQuery`
          // applies above; it does not inherit it. Without this a distance
          // sorted grid returned whole documents no matter what the caller
          // asked for — every variant and media entry, plus the private
          // digital-asset storage keys the `find()` path is careful to strip.
          // The inclusion form drops both markers on its own.
          query.cardFieldsOnly
            ? { $project: PRODUCT_CARD_PROJECTION }
            : {
                $project: {
                  __vendorRank: 0,
                  __unavailable: 0,
                  __score: 0,
                  search: 0,
                },
              },
        ])
          // `__vendorRank` is computed, so this sort cannot use an index and
          // runs in memory. That was survivable while location narrowed the
          // query to at most a few hundred vendors' products; as a lens it
          // sorts the whole catalogue, and a large one would otherwise hit
          // MongoDB's 100 MB in-memory sort ceiling and fail the request
          // outright rather than degrade.
          .allowDiskUse(true)
          .then((docs) =>
          Product.populate(docs, [
            {
              path: "vendorId",
              select:
                "storeName slug logo address.city storeVisibility.addressDisplay",
            },
            { path: "category", select: "name slug" },
            ...(query.cardFieldsOnly
              ? []
              : [{ path: "brand", select: "name slug logo" }]),
          ]),
        ),
        Product.countDocuments(mongoQuery),
      ]);

      const totalPages = Math.ceil(total / query.limit);

      return serializeResult(
        {
          // Same guard as the `find()` path below: a full-document response
          // must not carry private digital-asset storage keys.
          data: query.cardFieldsOnly
            ? products
            : products.map((product) =>
                stripLocationInventory(sanitizeDigitalAssetsForStorefront(product)),
              ),
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages,
            hasNext: query.page < totalPages,
            hasPrev: query.page > 1,
          },
          ...(searchCorrection ? { searchCorrection } : {}),
        },
        vendorDistances,
        collectNearbyVendors,
        query.cardFieldsOnly,
      );
    }

    /**
     * One page of an availability-first ordering, assembled from two ordinary
     * indexed finds — see `splitAvailabilityFirstPage` for why it is not one
     * sorted query.
     */
    const fetchAvailabilityFirstPage = async (): Promise<
      [Record<string, unknown>[], number]
    > => {
      const availableFilter = withStockConstraint(mongoQuery, AVAILABLE_STOCK_QUERY);

      const [total, availableTotal] = await Promise.all([
        Product.countDocuments(mongoQuery),
        Product.countDocuments(availableFilter),
      ]);

      const slices = splitAvailabilityFirstPage(
        skip,
        query.limit,
        availableTotal,
      );

      const [head, tail] = await Promise.all([
        slices.headLimit > 0
          ? buildProductsQuery(availableFilter)
              .sort(sort)
              .skip(slices.headSkip)
              .limit(slices.headLimit)
              .lean()
          : [],
        slices.tailLimit > 0
          ? buildProductsQuery(withStockConstraint(mongoQuery, UNAVAILABLE_STOCK_QUERY))
              .sort(sort)
              .skip(slices.tailSkip)
              .limit(slices.tailLimit)
              .lean()
          : [],
      ]);

      return [[...head, ...tail] as Record<string, unknown>[], total];
    };

    const fetchPage = async (): Promise<[Record<string, unknown>[], number]> =>
      sortOutOfStockLast
        ? fetchAvailabilityFirstPage()
        : ((await Promise.all([
            buildProductsQuery(mongoQuery)
              .sort(sort)
              .skip(skip)
              .limit(query.limit)
              .lean(),
            Product.countDocuments(mongoQuery),
          ])) as [Record<string, unknown>[], number]);

    const [products, total] = await fetchPage();

    const totalPages = Math.ceil(total / query.limit);

    return serializeResult(
      {
        // Full-document responses (cardFieldsOnly off) must not leak private
        // digital-asset storage keys into the public API.
        data: products.map((product) =>
          stripLocationInventory(sanitizeDigitalAssetsForStorefront(product)),
        ),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages,
          hasNext: query.page < totalPages,
          hasPrev: query.page > 1,
        },
        ...(searchCorrection ? { searchCorrection } : {}),
      },
      vendorDistances,
      collectNearbyVendors,
      query.cardFieldsOnly,
    );
  },
  ["storefront-products"],
  {
    revalidate: 60,
    tags: [
      CACHE_TAGS.products,
      CACHE_TAGS.categories,
      CACHE_TAGS.collections,
      CACHE_TAGS.brands,
      // The out-of-stock policy is read inside this function and cached on its
      // own tag, so without this an admin would save the setting and watch the
      // storefront ignore it for up to a minute.
      CACHE_TAGS.settings,
    ],
  },
);

export function getStorefrontProducts<T = unknown>(
  query: StorefrontProductsQuery = {},
) {
  const normalized = normalizeQuery(query);
  // Off the request path and outside the cache: a search on a partly indexed
  // catalogue queues a bounded batch of indexing rather than missing products
  // until someone runs the migration.
  if (normalized.search) scheduleProductSearchIndexHeal();
  return getStorefrontProductsCached(
    normalized,
  ) as Promise<StorefrontProductsResult<T>>;
}

/**
 * Whether the pre-order shelf has anything on it — some product a shopper
 * can reserve right now. The header drops its Pre-order link while this is
 * false, since the link would only lead to an empty page.
 *
 * Asks the same cached query /pre-order lists from, one card deep. A failed
 * read answers true: hiding the link over a database hiccup would take a live
 * shelf out of the nav.
 */
export async function hasOpenPreorders(): Promise<boolean> {
  try {
    const result = await getStorefrontProducts({
      preorder: true,
      limit: 1,
      cardFieldsOnly: true,
    });
    return result.pagination.total > 0;
  } catch {
    return true;
  }
}
