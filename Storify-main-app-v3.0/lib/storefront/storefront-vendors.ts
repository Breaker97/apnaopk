import { unstable_cache } from "next/cache";
import {
  ORDER_STATUS,
  PRODUCT_STATUS,
  VENDOR_STATUS,
} from "@/config/app.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import {
  getExternalVendorFilter,
  isMultiVendorEnabled,
} from "@/lib/vendors/multi-vendor";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import { resolveShareSettings, type ShareSettings } from "@/lib/site-config/share-config";
import {
  resolveSocialProfiles,
  socialProfilesFromLegacyLinks,
  type SocialProfile,
} from "@/lib/site-config/social-profiles";
import {
  VENDOR_ADDRESS_DISPLAY,
  resolveVendorStoreVisibility,
  type VendorAddressDisplay,
} from "@/lib/vendors/vendor-address";
import { resolveCoordinates } from "@/lib/intl/geocoding";
import {
  resolveVendorMessaging,
  type VendorMessagingSettings,
} from "@/lib/notifications/vendor-messaging";
import { Order, Product, Vendor } from "@/models";

/**
 * Address parts the storefront is allowed to see, already stripped to what the
 * vendor's `addressDisplay` permits. Nothing else survives the query — hiding
 * parts with CSS would still ship them in the HTML payload.
 *
 * Left unformatted on purpose: country-name and line composition are
 * locale-dependent, and this shape is cached once for every locale. The page
 * runs it through `formatVendorAddress(address, addressDisplay, locale)`.
 */
export type StorefrontVendorAddress = {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  /**
   * Geocoded point, published only at `full` precision — a coordinate IS the
   * street address, so it must never accompany a city-only display.
   */
  coordinates?: { lat: number; lng: number };
};

export type StorefrontVendorPickup = {
  address?: string;
  instructions?: string;
  readyInDaysMin?: number;
  readyInDaysMax?: number;
};

export type StorefrontVendor = {
  /** Needed to exclude this store's own products from "similar" suggestions. */
  id: string;
  storeName: string;
  slug: string;
  description?: string;
  logo?: string;
  banner?: string;
  shareSettings: ShareSettings;
  /**
   * Average of approved reviews across this vendor's products, with the count
   * behind it.
   *
   * Deliberately NOT `Vendor.rating`: that column is declared `default: 0` and
   * nothing in the codebase ever writes it, so reading it showed every store as
   * unrated regardless of its actual reviews.
   */
  rating: number;
  reviewCount: number;
  /**
   * Units across delivered sub-orders. Likewise not `Vendor.totalSales`, which
   * is another never-written column.
   */
  unitsSold: number;
  productCount: number;
  /** ISO timestamp; the header renders it as a "member since" month and year. */
  memberSince?: string;
  /**
   * Admin-awarded verification. The badge is rendered only when this is true —
   * never inferred from approval, documents or a paid plan, all of which the
   * storefront has already filtered on anyway.
   */
  verified: boolean;
  addressDisplay: VendorAddressDisplay;
  address?: StorefrontVendorAddress;
  /** Present only when the vendor separately opted into publishing it. */
  phone?: string;
  /** Only when the vendor enabled local pickup — buyer-facing by definition. */
  pickup?: StorefrontVendorPickup;
  processingDays?: { min: number; max: number };
  /** Vendor-chosen social profiles, rendered as icon buttons. */
  socialProfiles: SocialProfile[];
  messaging: VendorMessagingSettings;
};

type VendorLean = {
  storeName: string;
  slug: string;
  description?: string;
  logo?: string;
  banner?: string;
  shareSettings?: unknown;
  verified?: boolean;
  createdAt?: Date;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
    coordinates?: unknown;
  };
  socialLinks?: {
    facebook?: string;
    instagram?: string;
    twitter?: string;
  };
  socialProfiles?: unknown;
  storeVisibility?: unknown;
  messaging?: unknown;
  shipping?: {
    delivery?: {
      processingDaysMin?: number;
      processingDaysMax?: number;
    };
    localPickup?: {
      enabled?: boolean;
      pickupAddress?: string;
      instructions?: string;
      readyInDaysMin?: number;
      readyInDaysMax?: number;
    };
  };
  _id: unknown;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Strip the stored address down to the parts `mode` permits. `city_country`
 * drops street, state and postal code entirely rather than relying on the
 * renderer to omit them.
 */
function gateAddress(
  address: VendorLean["address"],
  mode: VendorAddressDisplay,
): StorefrontVendorAddress | undefined {
  if (!address || mode === VENDOR_ADDRESS_DISPLAY.HIDDEN) return undefined;

  const city = text(address.city);
  const country = text(address.country);

  if (mode === VENDOR_ADDRESS_DISPLAY.CITY_COUNTRY) {
    if (!city && !country) return undefined;
    return { city, country };
  }

  const coordinates = resolveCoordinates(address.coordinates);

  const gated: StorefrontVendorAddress = {
    street: text(address.street),
    city,
    state: text(address.state),
    postalCode: text(address.postalCode),
    country,
    // Only the point itself crosses to the client. `formatted`/`geocodedAt` are
    // operational metadata about the lookup, not something a buyer needs.
    coordinates: coordinates
      ? { lat: coordinates.lat, lng: coordinates.lng }
      : undefined,
  };

  // Coordinates alone are not an address to render — a point with no text would
  // draw an empty panel with a Directions button under it.
  const hasText = Boolean(
    gated.street || gated.city || gated.state || gated.postalCode || gated.country,
  );

  return hasText ? gated : undefined;
}

function gatePickup(
  shipping: VendorLean["shipping"],
): StorefrontVendorPickup | undefined {
  const pickup = shipping?.localPickup;
  if (!pickup?.enabled) return undefined;

  const address = text(pickup.pickupAddress);
  const instructions = text(pickup.instructions);
  const readyInDaysMin =
    typeof pickup.readyInDaysMin === "number" ? pickup.readyInDaysMin : undefined;
  const readyInDaysMax =
    typeof pickup.readyInDaysMax === "number" ? pickup.readyInDaysMax : undefined;

  if (!address && !instructions && readyInDaysMax === undefined) {
    return undefined;
  }

  return { address, instructions, readyInDaysMin, readyInDaysMax };
}

function resolveProcessingDays(
  shipping: VendorLean["shipping"],
): { min: number; max: number } | undefined {
  const delivery = shipping?.delivery;
  const min =
    typeof delivery?.processingDaysMin === "number"
      ? delivery.processingDaysMin
      : 0;
  const max =
    typeof delivery?.processingDaysMax === "number"
      ? delivery.processingDaysMax
      : 0;

  // A 0–0 window says nothing useful, so the strip omits the fact entirely
  // rather than promising "ships in 0 days".
  if (max <= 0) return undefined;
  return { min: Math.max(0, Math.min(min, max)), max };
}

/**
 * The vendor's social profiles: their chosen list when they have one, otherwise
 * derived from the legacy fixed facebook/instagram/twitter fields so nobody's
 * links vanish without a migration.
 */
function resolveVendorSocialProfiles(vendor: VendorLean): SocialProfile[] {
  const chosen = resolveSocialProfiles(vendor.socialProfiles);
  if (chosen.length > 0) return chosen;
  return socialProfilesFromLegacyLinks(vendor.socialLinks ?? {});
}

type VendorReviewStats = { rating: number; reviewCount: number };

export const EMPTY_VENDOR_REVIEW_STATS: VendorReviewStats = {
  rating: 0,
  reviewCount: 0,
};

/**
 * Average rating and review count per vendor, derived from approved reviews on
 * their products.
 *
 * Batched by design: the home page needs this for a whole carousel of vendors,
 * and doing it per vendor would be a query per card. Every product counts,
 * including ones since archived — a delivered order that earned a review still
 * reflects on the seller.
 *
 * Reads `Product.rating` / `Product.reviewCount` rather than joining `reviews`.
 * Those two columns are maintained by `recomputeProductRating()` on every review
 * create, approve, edit and delete, so they are authoritative — and this used to
 * `$lookup` into `reviews` once per product, which meant a vendor with 10,000
 * products cost 10,000 sub-queries to render one header. Now it is a single
 * indexed scan and a `$group`.
 *
 * Weighting by `reviewCount` (rather than averaging the per-product averages)
 * keeps the vendor mean proportional to review volume. `Product.rating` is
 * itself stored rounded to one decimal, so the reconstructed sum can be off by
 * up to 0.05 per product — well inside the one decimal this is rendered at.
 */
export async function getVendorReviewStatsMap(
  vendorIds: unknown[],
): Promise<Map<string, VendorReviewStats>> {
  const stats = new Map<string, VendorReviewStats>();
  if (vendorIds.length === 0) return stats;

  const rows = await Product.aggregate<{
    _id: unknown;
    ratingSum: number;
    reviewCount: number;
  }>([
    // `reviewCount: { $gt: 0 }` drops never-reviewed products before the group
    // instead of summing zeros across the whole catalogue.
    { $match: { vendorId: { $in: vendorIds }, reviewCount: { $gt: 0 } } },
    {
      $group: {
        _id: "$vendorId",
        ratingSum: {
          $sum: {
            $multiply: [
              { $ifNull: ["$rating", 0] },
              { $ifNull: ["$reviewCount", 0] },
            ],
          },
        },
        reviewCount: { $sum: { $ifNull: ["$reviewCount", 0] } },
      },
    },
  ]);

  for (const row of rows) {
    if (!row.reviewCount || row.reviewCount <= 0) continue;
    stats.set(String(row._id), {
      // One decimal, matching how it is rendered.
      rating: Math.round((row.ratingSum / row.reviewCount) * 10) / 10,
      reviewCount: row.reviewCount,
    });
  }

  return stats;
}

/**
 * Units each vendor has actually delivered.
 *
 * Only `delivered` sub-orders count — pending, processing and shipped ones are
 * not sales yet, and cancelled ones never will be.
 *
 * Pipeline order is load-bearing at scale:
 *
 * 1. `$elemMatch` keeps the leading `{ "subOrders.vendorId": 1, createdAt: -1 }`
 *    index usable while requiring vendor and status to match the SAME sub-order.
 *    Two dotted conditions would have matched an order where one sub-order is
 *    this vendor's and a different one happens to be delivered, dragging every
 *    such order through the unwind for nothing.
 * 2. `$project` strips the order down to the three fields the sum needs. Orders
 *    are heavy documents — items, addresses, payment, status history — and
 *    `$unwind` copies whatever is still attached once per sub-order.
 * 3. The post-unwind `$match` is what actually decides which sub-orders count.
 */
export async function getVendorUnitsSoldMap(
  vendorIds: unknown[],
): Promise<Map<string, number>> {
  const sold = new Map<string, number>();
  if (vendorIds.length === 0) return sold;

  const rows = await Order.aggregate<{ _id: unknown; units: number }>([
    {
      $match: {
        subOrders: {
          $elemMatch: {
            vendorId: { $in: vendorIds },
            status: ORDER_STATUS.DELIVERED,
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        "subOrders.vendorId": 1,
        "subOrders.status": 1,
        "subOrders.items.quantity": 1,
      },
    },
    { $unwind: "$subOrders" },
    {
      $match: {
        "subOrders.vendorId": { $in: vendorIds },
        "subOrders.status": ORDER_STATUS.DELIVERED,
      },
    },
    {
      $group: {
        _id: "$subOrders.vendorId",
        units: { $sum: { $sum: "$subOrders.items.quantity" } },
      },
    },
  ]);

  for (const row of rows) {
    if (typeof row.units === "number" && Number.isFinite(row.units)) {
      sold.set(String(row._id), row.units);
    }
  }

  return sold;
}

export const getStorefrontVendorBySlug = unstable_cache(
  async (slug: string): Promise<StorefrontVendor | null> => {
    await connectDB();

    const multiVendorEnabled = await isMultiVendorEnabled();
    if (!multiVendorEnabled) return null;

    const vendor = await Vendor.findOne({
      ...getExternalVendorFilter(),
      slug: slug.toLowerCase(),
      status: VENDOR_STATUS.APPROVED,
      // Deactivated stores (lapsed paid plan) return 404 on the storefront.
      storeActive: { $ne: false },
    })
      // `rating` and `totalSales` are deliberately absent: both are dead columns
      // (never written), and the real figures are aggregated below.
      .select(
        "storeName slug description logo banner shareSettings verified createdAt address socialLinks socialProfiles storeVisibility messaging shipping.delivery shipping.localPickup",
      )
      .lean<VendorLean | null>();

    if (!vendor) return null;

    const [productCount, reviewStatsMap, unitsSoldMap] = await Promise.all([
      // Same constraint the product grid and filters use, so the headline count
      // can never disagree with the number of cards rendered below it.
      Product.countDocuments({
        status: PRODUCT_STATUS.ACTIVE,
        ...(await getStorefrontProductConstraint()),
        vendorId: vendor._id,
      }),
      // Same helpers the home carousel uses, so a vendor's rating can never
      // read differently there than on their own store page.
      getVendorReviewStatsMap([vendor._id]),
      getVendorUnitsSoldMap([vendor._id]),
    ]);

    const vendorKey = String(vendor._id);
    const reviewStats =
      reviewStatsMap.get(vendorKey) ?? EMPTY_VENDOR_REVIEW_STATS;
    const unitsSold = unitsSoldMap.get(vendorKey) ?? 0;

    const visibility = resolveVendorStoreVisibility(vendor.storeVisibility);

    // The vendor's own choice, always. A store that has never set a precision
    // gets the schema default — never a widened one, because the whole point of
    // `addressDisplay` is that publishing a street address is an explicit
    // decision by the person who trades from it.
    const addressDisplay = visibility.addressDisplay;
    const address = gateAddress(vendor.address, addressDisplay);

    const pickup = gatePickup(vendor.shipping);
    const processingDays = resolveProcessingDays(vendor.shipping);
    const socialProfiles = resolveVendorSocialProfiles(vendor);

    return JSON.parse(
      JSON.stringify({
        id: String(vendor._id),
        storeName: vendor.storeName,
        slug: vendor.slug,
        description: text(vendor.description),
        logo: text(vendor.logo),
        banner: text(vendor.banner),
        shareSettings: resolveShareSettings(vendor.shareSettings),
        rating: reviewStats.rating,
        reviewCount: reviewStats.reviewCount,
        unitsSold,
        productCount,
        // Strictly the stored flag: every vendor that reaches this point is
        // already approved and live, so treating a missing value as "verified"
        // would hand the badge to the entire marketplace.
        verified: vendor.verified === true,
        memberSince: vendor.createdAt,
        addressDisplay,
        address,
        // Gated twice over: the vendor must opt into showing a phone AND have
        // published an address to attach it to.
        phone:
          visibility.showPhone && address
            ? text(vendor.address?.phone)
            : undefined,
        pickup,
        processingDays,
        socialProfiles,
        messaging: resolveVendorMessaging(vendor.messaging),
      }),
    ) as StorefrontVendor;
  },
  ["storefront-vendor-by-slug"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.products, CACHE_TAGS.settings],
  },
);

/** One card on the public vendor directory. */
export type StorefrontVendorDirectoryEntry = {
  id: string;
  storeName: string;
  slug: string;
  description?: string;
  logo?: string;
  banner?: string;
  verified: boolean;
  rating: number;
  reviewCount: number;
  productCount: number;
};

type StorefrontVendorDirectory = {
  vendors: StorefrontVendorDirectoryEntry[];
  page: number;
  totalPages: number;
};

/**
 * Paginated public directory of every live external store, newest first.
 *
 * Returns null when multi-vendor is off — the /vendors page 404s rather than
 * advertising a marketplace that doesn't exist. Same eligibility rules as
 * `getStorefrontVendorBySlug`, so the directory can never list a store whose
 * own page would 404.
 */
export const getStorefrontVendorDirectory = unstable_cache(
  async (
    page: number,
    pageSize: number,
  ): Promise<StorefrontVendorDirectory | null> => {
    await connectDB();

    const multiVendorEnabled = await isMultiVendorEnabled();
    if (!multiVendorEnabled) return null;

    const filter = {
      ...getExternalVendorFilter(),
      status: VENDOR_STATUS.APPROVED,
      storeActive: { $ne: false },
    };

    const total = await Vendor.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    // An out-of-range ?page= clamps to a real page instead of an empty grid.
    const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);

    const vendors = await Vendor.find(filter)
      .select("storeName slug description logo banner verified")
      .sort({ createdAt: -1, _id: -1 })
      .skip((safePage - 1) * pageSize)
      .limit(pageSize)
      .lean<
        {
          _id: unknown;
          storeName: string;
          slug: string;
          description?: string;
          logo?: string;
          banner?: string;
          verified?: boolean;
        }[]
      >();

    const vendorIds = vendors.map((vendor) => vendor._id);

    const [reviewStatsMap, productCounts] = await Promise.all([
      getVendorReviewStatsMap(vendorIds),
      // Same constraint the store page's headline count uses, so a card's
      // product count always matches the grid behind its link.
      vendorIds.length > 0
        ? Product.aggregate<{ _id: unknown; count: number }>([
            {
              $match: {
                status: PRODUCT_STATUS.ACTIVE,
                ...(await getStorefrontProductConstraint()),
                vendorId: { $in: vendorIds },
              },
            },
            { $group: { _id: "$vendorId", count: { $sum: 1 } } },
          ])
        : [],
    ]);

    const productCountMap = new Map<string, number>();
    for (const row of productCounts) {
      productCountMap.set(String(row._id), row.count);
    }

    return {
      vendors: vendors.map((vendor) => {
        const key = String(vendor._id);
        const reviews = reviewStatsMap.get(key) ?? EMPTY_VENDOR_REVIEW_STATS;

        return {
          id: key,
          storeName: vendor.storeName,
          slug: vendor.slug,
          description: text(vendor.description),
          logo: text(vendor.logo),
          banner: text(vendor.banner),
          verified: vendor.verified === true,
          rating: reviews.rating,
          reviewCount: reviews.reviewCount,
          productCount: productCountMap.get(key) ?? 0,
        };
      }),
      page: safePage,
      totalPages,
    };
  },
  ["storefront-vendor-directory"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.products, CACHE_TAGS.settings],
  },
);
