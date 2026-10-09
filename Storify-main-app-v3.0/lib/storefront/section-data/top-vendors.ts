import "server-only";

import { unstable_cache } from "next/cache";
import { PRODUCT_STATUS, VENDOR_STATUS } from "@/config/app.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { isStorefrontMultiVendorEnabled } from "@/lib/catalog/product-visibility";
import { connectDB, mongoose } from "@/lib/db";
import { readStoreCurrency } from "@/lib/intl/server-currency";
import { withFallback } from "@/lib/storefront/cached-read";
import type { TopVendorSource } from "@/lib/storefront/sections/top-vendors";
import {
  EMPTY_VENDOR_REVIEW_STATS,
  getVendorReviewStatsMap,
  getVendorUnitsSoldMap,
} from "@/lib/storefront/storefront-vendors";
import { getExternalVendorFilter } from "@/lib/vendors/multi-vendor";
import { Product, Vendor } from "@/models";

/** One store in the Top Vendors row. */
export interface TopVendorCard {
  id: string;
  storeName: string;
  slug: string;
  tagline: string;
  logo: string;
  banner: string;
  /** Mean of approved product reviews; 0 when the store has none yet. */
  rating: number;
  reviewCount: number;
  /** Units in delivered sub-orders. */
  unitsSold: number;
  priceTier: string;
}

interface VendorCandidate {
  _id: mongoose.Types.ObjectId;
  storeName: string;
  slug: string;
  description?: string;
  logo?: string;
  banner?: string;
}

/**
 * Upper bound on how many vendors are ranked. Ranking happens in JS because the
 * ordering keys (rating, units sold) are aggregated, not stored, so the work has
 * to stay bounded on a page this hot.
 */
const CANDIDATE_POOL_CAP = 60;

const CANDIDATE_FIELDS = "storeName slug description logo banner createdAt";

/** Ranked orders. Candidates arrive newest-first, so ties keep that order. */
const RANKINGS: Record<
  Exclude<TopVendorSource, "manual">,
  ((a: TopVendorCard, b: TopVendorCard) => number) | null
> = {
  // Ties fall back to newest-first, so a brand-new store is not buried forever.
  topRated: (a, b) => b.rating - a.rating || b.unitsSold - a.unitsSold,
  bestSelling: (a, b) => b.unitsSold - a.unitsSold || b.rating - a.rating,
  // Already in creation order.
  newest: null,
};

/**
 * Price band shown on a vendor card, in the store's own currency.
 *
 * "$$$" reads as a price band, but "UShUShUSh" does not — so only
 * single-character symbols are repeated; longer ones take "+" marks instead.
 */
function priceTier(
  avgPrice: number | null | undefined,
  symbol: string,
): string {
  const level =
    !avgPrice || !Number.isFinite(avgPrice) || avgPrice <= 0 || avgPrice < 50
      ? 1
      : avgPrice < 200
        ? 2
        : 3;

  return symbol.length === 1
    ? symbol.repeat(level)
    : `${symbol}${"+".repeat(level - 1)}`;
}

/**
 * The stores to rank: a pool wider than `limit`, because "top" is decided on
 * derived figures that no column holds. Bounded so the home page never
 * aggregates over an unbounded vendor list.
 */
function findRankCandidates(limit: number) {
  return Vendor.find({
    ...getExternalVendorFilter(),
    status: VENDOR_STATUS.APPROVED,
  })
    .select(CANDIDATE_FIELDS)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit * 5, 24), CANDIDATE_POOL_CAP))
    .lean<VendorCandidate[]>();
}

/** The merchant's picks that are still approved, in the order picked. */
async function findPickedVendors(ids: string[]): Promise<VendorCandidate[]> {
  const valid = ids.filter((id) => mongoose.isValidObjectId(id));
  if (valid.length === 0) return [];
  const vendors = await Vendor.find({
    ...getExternalVendorFilter(),
    _id: { $in: valid },
    status: VENDOR_STATUS.APPROVED,
  })
    .select(CANDIDATE_FIELDS)
    .lean<VendorCandidate[]>();
  const byId = new Map(vendors.map((vendor) => [String(vendor._id), vendor]));
  return valid.flatMap((id) => byId.get(id) ?? []);
}

/**
 * The Top Vendors row: approved sellers — ranked (best rated, best selling
 * or newest) or the merchant's picks in their order — optionally without
 * stores that have nothing on sale. Empty on a single-seller store.
 *
 * The defaults are the row as it always read (best rated first, then best
 * selling), so `readTopVendors(limit)` — the shopper app's home block —
 * answers exactly what it did.
 *
 * Primitive arguments: they are the cache key, so the picks travel as one
 * comma-joined string rather than an array. A failed read throws;
 * `fetchTopVendors` is the storefront's reader, which answers an empty row.
 */
export const readTopVendors = unstable_cache(
  async (
    limit: number,
    source: TopVendorSource = "topRated",
    pickedIds = "",
    hideEmptyStores = false,
  ): Promise<TopVendorCard[]> => {
    await connectDB();

    const enabled = await isStorefrontMultiVendorEnabled();
    if (!enabled) return [];

    // Cached alongside the cards and invalidated by CACHE_TAGS.settings, so
    // switching the store currency refreshes the bands with it. The throwing
    // read: a fallback currency would be kept in this entry as the store's.
    const storeCurrency = await readStoreCurrency();
    const currencySymbol = storeCurrency.symbol || storeCurrency.code;

    const manual = source === "manual";
    const candidates = manual
      ? await findPickedVendors(pickedIds ? pickedIds.split(",") : [])
      : await findRankCandidates(limit);

    if (candidates.length === 0) return [];

    const vendorIds = candidates.map((v) => v._id);

    const [aggregates, reviewStats, unitsSold] = await Promise.all([
      Product.aggregate<{
        _id: mongoose.Types.ObjectId;
        avgPrice: number;
        productCount: number;
      }>([
        {
          $match: {
            vendorId: { $in: vendorIds },
            status: PRODUCT_STATUS.ACTIVE,
          },
        },
        {
          $group: {
            _id: "$vendorId",
            avgPrice: { $avg: "$price" },
            productCount: { $sum: 1 },
          },
        },
      ]),
      // Shared with the vendor storefront page, so a store's rating reads the
      // same in both places. `Vendor.rating` and `Vendor.totalSales` are not
      // used: nothing writes them, so every card used to show 0.0 and no sales.
      getVendorReviewStatsMap(vendorIds),
      getVendorUnitsSoldMap(vendorIds),
    ]);

    const aggregateMap = new Map<
      string,
      { avgPrice: number; productCount: number }
    >();
    for (const item of aggregates) {
      aggregateMap.set(String(item._id), {
        avgPrice: item.avgPrice,
        productCount: item.productCount,
      });
    }

    const cards = candidates
      .filter(
        (vendor) =>
          !hideEmptyStores ||
          (aggregateMap.get(String(vendor._id))?.productCount ?? 0) > 0,
      )
      .map((vendor): TopVendorCard => {
        const key = String(vendor._id);
        const stats = aggregateMap.get(key);
        const reviews = reviewStats.get(key) ?? EMPTY_VENDOR_REVIEW_STATS;

        return {
          id: key,
          storeName: vendor.storeName,
          slug: vendor.slug,
          tagline: vendor.description?.trim() || "",
          logo: vendor.logo || "",
          banner: vendor.banner || "",
          rating: reviews.rating,
          reviewCount: reviews.reviewCount,
          unitsSold: unitsSold.get(key) ?? 0,
          priceTier: priceTier(stats?.avgPrice, currencySymbol),
        };
      });

    // Picks keep the merchant's order, and every one of them shows.
    if (manual) return cards;

    const ranking = RANKINGS[source];
    return (ranking ? cards.sort(ranking) : cards).slice(0, limit);
  },
  ["home-top-vendors"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.products, CACHE_TAGS.settings],
  },
);

export const fetchTopVendors = withFallback(readTopVendors, () => []);
