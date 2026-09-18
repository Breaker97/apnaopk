import { unstable_cache } from "next/cache";
import { PRODUCT_STATUS } from "@/config/app.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB, mongoose } from "@/lib/db";
import {
  getStorefrontOutOfStockDisplay,
  getStorefrontProductConstraint,
} from "@/lib/catalog/product-visibility";
import { OUT_OF_STOCK_DISPLAY } from "@/lib/catalog/catalog-display";
import {
  AVAILABLE_STOCK_QUERY,
  UNAVAILABLE_STOCK_QUERY,
  withStockConstraint,
} from "@/lib/products/stock-policy";
import { Product } from "@/models";
import type { ModernProduct } from "@/lib/products/modern-product";

type SortableProductCardField = "createdAt" | "price" | "rating" | "reviewCount";

export type StorefrontProductCardQuery = {
  limit?: number;
  ids?: string[];
  categoryIds?: string[];
  excludeIds?: string[];
  /**
   * Drop one vendor's own products from the result. Used by a vendor storefront
   * to suggest comparable items from *other* stores, which would otherwise just
   * repeat the grid directly above it.
   */
  excludeVendorId?: string;
  featured?: boolean;
  onSale?: boolean;
  /**
   * Drop products nothing can be bought from. Used by the sponsored lane's
   * organic fillers, so "available" means the same thing on both halves of a
   * mixed rail — otherwise the rail withholds a PAID out-of-stock product and
   * fills its slot with an unpaid one.
   */
  hideOutOfStock?: boolean;
  status?: string;
  sortBy?: SortableProductCardField;
  sortOrder?: "asc" | "desc";
  /**
   * No location fields, deliberately. A shopper's location is a lens on the
   * storefront rather than a filter (see `getStorefrontProducts`), so a strip of
   * eight cards on the home page shows the same eight wherever the shopper is —
   * and a strip that quietly emptied itself for a location the shopper set days
   * ago is the worst possible place to discover that rule.
   */
};

type ProductCardCategory = {
  _id?: string;
  name?: string;
  slug?: string;
};

export type StorefrontProductCard = ModernProduct & {
  category?: string | ProductCardCategory;
};

export const PRODUCT_CARD_SELECT = [
  "name",
  "title",
  "slug",
  "price",
  "comparePrice",
  "priceRange",
  "compareAtPriceRange",
  // A quote-only product prints no price and no Add to cart button; without
  // these the card would render a bare "$0.00" for it.
  "priceOnRequest",
  "quoteButtonLabel",
  "images",
  "media",
  "rating",
  "reviewCount",
  "stock",
  // Availability is not `stock > 0` for digital / untracked products — the card
  // needs the policy fields lib/products/stock-policy.ts reads.
  "shipping.isPhysicalProduct",
  "inventory",
  "preorder",
  "featured",
  "status",
  "options",
  "variants",
  "createdAt",
  "vendorId",
  "category",
  // The id only: the card resolves it through the brand directory mounted
  // with its configuration (lib/brands/card-brand-directory.ts).
  "brand",
].join(" ");

function clampLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) return 12;
  return Math.min(Math.max(Math.floor(limit || 12), 1), 48);
}

function buildSort(query: StorefrontProductCardQuery): Record<string, 1 | -1> {
  const direction = query.sortOrder === "asc" ? 1 : -1;

  if (query.sortBy === "price") return { price: direction };
  if (query.sortBy === "rating") return { rating: direction, reviewCount: -1 };
  if (query.sortBy === "reviewCount") {
    return { reviewCount: direction, rating: -1, createdAt: -1 };
  }

  return { createdAt: direction };
}

/**
 * Variant fields a card can read (see `ModernProduct`'s variant type). The
 * raw subdocument also carries per-location inventory rows, SKU/barcode
 * normalisations, cost, tax and shipping dimensions — ~15 KB per card on the
 * home page, none of it rendered. Anything a variant picker needs beyond this
 * (SKU, weight, barcode) comes from the product page's full fetch.
 */
const VARIANT_CARD_FIELDS = [
  "_id",
  "name",
  "price",
  "comparePrice",
  "stock",
  "image",
  "images",
  "mediaId",
  "optionValues",
  "preorder",
] as const;

function pickVariantCardFields(variant: unknown): unknown {
  if (!variant || typeof variant !== "object") return variant;
  const source = variant as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of VARIANT_CARD_FIELDS) {
    if (source[field] !== undefined) picked[field] = source[field];
  }
  return picked;
}

/**
 * `JSON.stringify` replacer for product-card payloads. One pass converts
 * ObjectIds/Dates (including those nested in variants/options/media) to
 * JSON-safe primitives, drops a `category` that serialised to null
 * (unpopulated reference), and trims every variant to its card fields.
 *
 * Every storefront surface that serialises cards — the section rails, the
 * infinite grid, the sponsored lane, collection shelves — must go through
 * this or `serializeProductCards`, so the shape the card receives is the same
 * whichever loader produced it.
 */
export function productCardReplacer(key: string, value: unknown): unknown {
  if (key === "category" && value === null) return undefined;
  if (key === "variants" && Array.isArray(value)) {
    return value.map(pickVariantCardFields);
  }
  return value;
}

export function serializeProductCards(products: unknown[]): StorefrontProductCard[] {
  return JSON.parse(
    JSON.stringify(products, productCardReplacer),
  ) as StorefrontProductCard[];
}

export const getStorefrontProductCards = unstable_cache(
  async (
    query: StorefrontProductCardQuery = {},
  ): Promise<StorefrontProductCard[]> => {
    await connectDB();

    const limit = clampLimit(query.limit);
    const mongoQuery: Record<string, unknown> = {
      status: query.status || PRODUCT_STATUS.ACTIVE,
      ...(await getStorefrontProductConstraint()),
    };

    if (query.featured) {
      mongoQuery.featured = true;
    }

    if (query.hideOutOfStock) {
      mongoQuery.$and = [
        ...((mongoQuery.$and as Record<string, unknown>[]) || []),
        AVAILABLE_STOCK_QUERY,
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
                    as: "variant",
                    in: { $gt: ["$$variant.comparePrice", "$$variant.price"] },
                  },
                },
              },
            ],
          },
        },
      ];
    }

    if (query.ids !== undefined) {
      const ids = query.ids
        .map((value) => value.trim())
        .filter((value) => mongoose.isValidObjectId(value));

      if (ids.length === 0) return [];

      mongoQuery._id = { $in: ids };
    }

    if (query.categoryIds !== undefined) {
      const categoryIds = query.categoryIds
        .map((value) => value.trim())
        .filter((value) => mongoose.isValidObjectId(value));

      if (categoryIds.length === 0) return [];

      mongoQuery.category = { $in: categoryIds };
    }

    if (query.excludeIds?.length) {
      const excludeIds = query.excludeIds
        .map((value) => value.trim())
        .filter((value) => mongoose.isValidObjectId(value));

      if (excludeIds.length > 0) {
        const existingIdFilter =
          typeof mongoQuery._id === "object" && mongoQuery._id !== null
            ? (mongoQuery._id as Record<string, unknown>)
            : {};
        mongoQuery._id = { ...existingIdFilter, $nin: excludeIds };
      }
    }

    if (
      query.excludeVendorId &&
      mongoose.isValidObjectId(query.excludeVendorId)
    ) {
      // Narrows the vendorId filter the storefront constraint already set, so
      // the approved-vendor restriction is preserved rather than replaced.
      const existingVendorFilter =
        typeof mongoQuery.vendorId === "object" && mongoQuery.vendorId !== null
          ? (mongoQuery.vendorId as Record<string, unknown>)
          : {};
      mongoQuery.vendorId = {
        ...existingVendorFilter,
        $ne: new mongoose.Types.ObjectId(query.excludeVendorId),
      };
    }

    // The platform policy, on top of whatever the caller already asked for.
    // `query.hideOutOfStock` stays independent: the sponsored lane sets it to
    // match a paid rail's own rule, which must hold even under "show".
    const outOfStockDisplay = await getStorefrontOutOfStockDisplay();

    if (outOfStockDisplay === OUT_OF_STOCK_DISPLAY.HIDE) {
      mongoQuery.$and = [
        ...((mongoQuery.$and as Record<string, unknown>[]) || []),
        AVAILABLE_STOCK_QUERY,
      ];
    }

    const sort = buildSort(query);

    const runFind = (filter: Record<string, unknown>, take: number) =>
      Product.find(filter)
        .select(PRODUCT_CARD_SELECT)
        .populate("vendorId", "storeName slug")
        .populate("category", "name slug")
        .sort(sort)
        .limit(take)
        .lean();

    let products;

    if (outOfStockDisplay === OUT_OF_STOCK_DISPLAY.LAST) {
      // A strip has no second page, so "last" means a sold-out product only
      // takes a slot no available product wanted. Fill from the buyable
      // partition first and top up from the other only if the strip is short —
      // one query in the ordinary case, and both of them indexed.
      const available = await runFind(withStockConstraint(mongoQuery, AVAILABLE_STOCK_QUERY), limit);
      const shortfall = limit - available.length;

      products =
        shortfall > 0
          ? [
              ...available,
              ...(await runFind(withStockConstraint(mongoQuery, UNAVAILABLE_STOCK_QUERY), shortfall)),
            ]
          : available;
    } else {
      products = await runFind(mongoQuery, limit);
    }

    const serialized = serializeProductCards(products);

    if (!query.ids?.length) return serialized;

    const order = new Map(query.ids.map((id, index) => [id, index]));
    return serialized.sort(
      (a, b) =>
        (order.get(a._id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b._id) ?? Number.MAX_SAFE_INTEGER),
    );
  },
  ["storefront-product-cards"],
  {
    revalidate: 60,
    // `settings` because the out-of-stock policy read inside this function is
    // cached separately: without it an admin saves the setting, reloads the
    // storefront, sees no change for up to a minute, and reasonably concludes
    // the switch is broken.
    tags: [CACHE_TAGS.products, CACHE_TAGS.settings],
  },
);
