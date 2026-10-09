import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { wishlistProductIds } from "@/lib/customers/wishlist";
import { connectDB } from "@/lib/db";
import {
  getStorefrontProductCards,
  type StorefrontProductCard,
} from "@/lib/products/storefront-product-cards";
import { normalizeHeaderSettings } from "@/lib/site-config/header-config";
import {
  getStorefrontCategories,
  type StorefrontCategory,
} from "@/lib/storefront/storefront-categories";
import { Category, CustomerProfile, Order, Product } from "@/models";
import { getSettingsLean } from "@/models/settings.model";

/**
 * What a search page shows before anything is typed: the terms the store
 * calls trending, its popular categories, and, for a signed-in shopper,
 * products picked for them. The website's search drawer shows the first two;
 * the shopper app shows all three (GET /search/start, GET /me/search/start).
 */

/** The most categories offered as popular. */
const POPULAR_CATEGORY_LIMIT = 8;
/** The most products on the "For you" shelf. */
const FOR_YOU_LIMIT = 12;

/**
 * The trending terms the store typed into its header's search drawer
 * (Online Store → Header → Search), in its order. Empty when it typed none.
 */
export async function readTrendingSearches(): Promise<string[]> {
  const settings = await getSettingsLean();
  const layout = normalizeHeaderSettings((settings as { header?: unknown }).header).builder;
  for (const row of layout.rows) {
    for (const column of row.columns) {
      for (const item of column.items) {
        if (item.type === "searchIcon" && item.trending.length > 0) {
          return item.trending.map((term) => term.trim()).filter(Boolean);
        }
      }
    }
  }
  return [];
}

function flatten(nodes: StorefrontCategory[]): StorefrontCategory[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

const featuredCategoryIds = unstable_cache(
  async (): Promise<string[]> => {
    await connectDB();
    const rows = await Category.find({ featured: true, isActive: true })
      .select("_id")
      .lean<Array<{ _id: unknown }>>();
    return rows.map((row) => String(row._id));
  },
  ["search-start-featured-categories"],
  { revalidate: 60, tags: [CACHE_TAGS.categories] },
);

/**
 * The store's popular categories: the ones it marks featured (Catalog →
 * Categories), in its own order; without any, the ones holding the most
 * products. Each with the categories inside it, as GET /categories has it.
 */
export async function readPopularCategories(): Promise<StorefrontCategory[]> {
  const [{ categories }, featured] = await Promise.all([
    getStorefrontCategories(),
    featuredCategoryIds(),
  ]);
  const all = flatten(categories);
  const marked = new Set(featured);
  const picked = marked.size > 0
    ? all.filter((category) => marked.has(String(category._id)))
    : all
        .filter((category) => category.productCount > 0)
        .sort((a, b) => b.productCount - a.productCount);
  return picked.slice(0, POPULAR_CATEGORY_LIMIT);
}

const idOf = (value: unknown): string =>
  value && typeof value === "object" && "_id" in value
    ? String((value as { _id: unknown })._id)
    : String(value ?? "");

/**
 * Products for one shopper: from the categories of what they saved, what
 * they bought lately and the categories they told the store they like, the
 * best rated in stock, leaving out what they already saved or bought. Empty
 * when the store has nothing to go on yet.
 */
export async function readForYouProducts(userId: string): Promise<StorefrontProductCard[]> {
  await connectDB();
  const [saved, orders, profile] = await Promise.all([
    wishlistProductIds(userId),
    Order.find({ customerId: userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .select("items.productId")
      .lean<Array<{ items?: Array<{ productId?: unknown }> }>>(),
    CustomerProfile.findOne({ userId })
      .select("preferredCategories")
      .lean<{ preferredCategories?: unknown[] } | null>(),
  ]);
  const bought = orders.flatMap((order) => (order.items ?? []).map((item) => idOf(item.productId)));
  const seen = [...new Set([...saved, ...bought].filter(Boolean))];

  const categoryIds = new Set((profile?.preferredCategories ?? []).map(idOf).filter(Boolean));
  if (seen.length > 0) {
    const products = await Product.find({ _id: { $in: seen.slice(0, 50) } })
      .select("category")
      .lean<Array<{ category?: unknown }>>();
    for (const product of products) {
      const category = idOf(product.category);
      if (category) categoryIds.add(category);
    }
  }
  if (categoryIds.size === 0) return [];

  return getStorefrontProductCards({
    categoryIds: [...categoryIds],
    excludeIds: seen,
    hideOutOfStock: true,
    sortBy: "rating",
    sortOrder: "desc",
    limit: FOR_YOU_LIMIT,
  });
}
