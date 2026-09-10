import { getTranslations } from "next-intl/server";
import { unstable_cache } from "next/cache";
import { connectDB, mongoose } from "@/lib/db";
import { Product, Vendor } from "@/models";
import { type Locale } from "@/config/i18n.config";
import { VENDOR_STATUS, PRODUCT_STATUS } from "@/config/app.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import {
  getExternalVendorFilter,
  isMultiVendorEnabled,
} from "@/lib/vendors/multi-vendor";
import {
  EMPTY_VENDOR_REVIEW_STATS,
  getVendorReviewStatsMap,
  getVendorUnitsSoldMap,
} from "@/lib/storefront/storefront-vendors";
import { getStoreCurrency } from "@/lib/intl/server-currency";
import {
  HomeTopVendorsCarousel,
  type TopVendorCard,
  type TopVendorsLabels,
} from "@/components/store/home-top-vendors-carousel";

interface HomeTopVendorsProps {
  locale: Locale;
  title: string;
  limit: number;
}

/**
 * Upper bound on how many vendors are ranked. Ranking happens in JS because the
 * ordering keys (rating, units sold) are aggregated, not stored, so the work has
 * to stay bounded on a page this hot.
 */
const CANDIDATE_POOL_CAP = 60;

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

const fetchTopVendors = unstable_cache(
  async (limit: number): Promise<TopVendorCard[]> => {
    try {
      await connectDB();

      const enabled = await isMultiVendorEnabled();
      if (!enabled) return [];

      // Cached alongside the cards and invalidated by CACHE_TAGS.settings, so
      // switching the store currency refreshes the bands with it.
      const storeCurrency = await getStoreCurrency();
      const currencySymbol = storeCurrency.symbol || storeCurrency.code;

      // A candidate pool wider than `limit`, because "top" is decided on
              // derived figures that no column holds. Bounded so the home page
      // never aggregates over an unbounded vendor list.
      const candidates = await Vendor.find({
        ...getExternalVendorFilter(),
        status: VENDOR_STATUS.APPROVED,
      })
        .select("storeName slug description logo banner createdAt")
        .sort({ createdAt: -1 })
        .limit(Math.min(Math.max(limit * 5, 24), CANDIDATE_POOL_CAP))
        .lean<
          {
            _id: mongoose.Types.ObjectId;
            storeName: string;
            slug: string;
            description?: string;
            logo?: string;
            banner?: string;
          }[]
        >();

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

      return (
        candidates
          .map((vendor) => {
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
          })
          // Best rated first, then best selling. Candidates arrive newest-first, so
          // ties keep that order and a brand-new store is not buried forever.
          //
          .sort((a, b) => b.rating - a.rating || b.unitsSold - a.unitsSold)
          .slice(0, limit)
      );
    } catch {
      return [];
    }
  },
  ["home-top-vendors"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.products, CACHE_TAGS.settings],
  },
);

async function getLabels(locale: Locale): Promise<TopVendorsLabels> {
  const tHome = await getTranslations({ locale, namespace: "home" });
  const safe = (
    key:
      | "topVendorsRating"
      | "topVendorsSold"
      | "topVendorsPrice"
      | "topVendorsGoToShop",
    fallback: string,
  ) => {
    try {
      return tHome(key);
    } catch {
      return fallback;
    }
  };

  return {
    rating: safe("topVendorsRating", "rating"),
    sold: safe("topVendorsSold", "sold"),
    price: safe("topVendorsPrice", "Price"),
    goToShop: safe("topVendorsGoToShop", "Go to Shop"),
    scrollLeft: "Scroll left",
    scrollRight: "Scroll right",
  };
}

export async function HomeTopVendors({
  locale,
  title,
  limit,
}: HomeTopVendorsProps) {
  const [vendors, labels] = await Promise.all([
    fetchTopVendors(limit),
    getLabels(locale),
  ]);

  if (vendors.length === 0) return null;

  return (
    <HomeTopVendorsCarousel
      locale={locale}
      title={title}
      vendors={vendors}
      labels={labels}
    />
  );
}
