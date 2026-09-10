import { unstable_cache } from "next/cache";
import { PRODUCT_STATUS } from "@/config/app.config";
import { STOREFRONT_BRAND_FILTER } from "@/lib/catalog/brands";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import { Brand, Product } from "@/models";

type StorefrontBrandListQuery = {
  all?: boolean;
  page?: number;
  limit?: number;
};

/**
 * No location fields, deliberately. A shopper's location is a lens on the
 * storefront, not a filter (see `getStorefrontProducts`), so it never changes
 * which products carry a brand — and carrying it here would only mint a
 * separate cache entry per place for an identical answer.
 */
type StorefrontBrandDetailQuery = StorefrontBrandListQuery & {
  slug: string;
  sort?: string;
};

const PRODUCT_FIELDS =
  "_id name title slug price comparePrice priceRange compareAtPriceRange priceOnRequest quoteButtonLabel images media rating reviewCount stock preorder featured status options variants createdAt vendorId";

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && (value || 0) > 0 ? Math.floor(value!) : fallback;
}

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildBrandProductSort(sort?: string): Record<string, 1 | -1> {
  switch (sort) {
    case "best-selling":
      return { reviewCount: -1, rating: -1, createdAt: -1 };
    case "title-asc":
      return { name: 1 };
    case "title-desc":
      return { name: -1 };
    case "price-asc":
      return { price: 1 };
    case "price-desc":
      return { price: -1 };
    case "created-desc":
      return { createdAt: -1 };
    case "featured":
    default:
      return { featured: -1, createdAt: -1 };
  }
}

async function getBrandProductCounts(): Promise<Map<string, number>> {
  const constraint = await getStorefrontProductConstraint();
  const grouped = await Product.aggregate<{ _id: unknown; count: number }>([
    {
      $match: {
        status: PRODUCT_STATUS.ACTIVE,
        brand: { $ne: null },
        ...constraint,
      },
    },
    { $group: { _id: "$brand", count: { $sum: 1 } } },
  ]);

  const counts = new Map<string, number>();
  for (const row of grouped) {
    if (row._id) counts.set(String(row._id), row.count);
  }
  return counts;
}

export const getStorefrontBrands = unstable_cache(
  async (query: StorefrontBrandListQuery = {}) => {
    await connectDB();

    const page = normalizePositiveInteger(query.page, 1);
    const limit = query.all
      ? Number.MAX_SAFE_INTEGER
      : Math.min(normalizePositiveInteger(query.limit, 20), 50);
    const skip = (page - 1) * limit;

    const visibilityFilter = { ...STOREFRONT_BRAND_FILTER };
    const [brands, total, counts] = await Promise.all([
      (query.all
        ? Brand.find(visibilityFilter)
        : Brand.find(visibilityFilter).skip(skip).limit(limit))
        .select("_id name slug description logo website order")
        .sort({ order: 1, name: 1 })
        .lean(),
      Brand.countDocuments(visibilityFilter),
      getBrandProductCounts(),
    ]);
    const totalPages = Math.ceil(total / limit);

    return serialize({
      brands: brands.map((brand) => ({
        _id: String(brand._id),
        name: brand.name,
        slug: brand.slug,
        description: brand.description,
        logo: brand.logo,
        website: brand.website,
        order: typeof brand.order === "number" ? brand.order : 0,
        productCount: counts.get(String(brand._id)) ?? 0,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  },
  ["storefront-brands"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.brands, CACHE_TAGS.products],
  },
);

export const getStorefrontBrandDetail = unstable_cache(
  async (query: StorefrontBrandDetailQuery) => {
    await connectDB();

    const page = normalizePositiveInteger(query.page, 1);
    const limit = Math.min(normalizePositiveInteger(query.limit, 24), 50);
    const brand = await Brand.findOne({
      slug: query.slug,
      ...STOREFRONT_BRAND_FILTER,
    }).lean();

    if (!brand) return null;

    const productQuery: Record<string, unknown> = {
      brand: brand._id,
      status: PRODUCT_STATUS.ACTIVE,
      ...(await getStorefrontProductConstraint()),
    };
    const skip = (page - 1) * limit;
    const [products, total] = await Promise.all([
      Product.find(productQuery)
        .select(PRODUCT_FIELDS)
        .populate("vendorId", "storeName slug")
        .sort(buildBrandProductSort(query.sort))
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(productQuery),
    ]);
    const totalPages = Math.ceil(total / limit);

    return serialize({
      brand: {
        _id: brand._id,
        name: brand.name,
        slug: brand.slug,
        description: brand.description,
        logo: brand.logo,
        website: brand.website,
        seo: brand.seo,
        productCount: total,
      },
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  },
  ["storefront-brand-detail"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.brands, CACHE_TAGS.products],
  },
);
