import { unstable_cache } from "next/cache";
import { Category } from "@/models";
import { connectDB } from "@/lib/db";
import { type Locale } from "@/config/i18n.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { type FeaturedCategoriesSource } from "@/lib/site-config/home-page-config";
import {
  HomeFeaturedCategoriesClient,
  type FeaturedCategory,
} from "./home-featured-categories-client";

interface HomeFeaturedCategoriesProps {
  locale: Locale;
  title: string;
  source: FeaturedCategoriesSource;
  limit: number;
  categoryIds: string[];
}

const CATEGORY_SELECT = "_id name slug image order featured";

function mapCategory(cat: {
  _id: unknown;
  name: string;
  slug: string;
  image?: string;
}): FeaturedCategory {
  return {
    id: String(cat._id),
    name: cat.name,
    slug: cat.slug,
    image: cat.image,
  };
}

/**
 * Exported alongside the section so per-theme overrides of it reuse the SAME
 * cached entry — a theme changes how the strip looks, never how often the
 * categories are queried.
 */
export const fetchFeaturedCategories = unstable_cache(
  async (
    source: FeaturedCategoriesSource,
    limit: number,
    categoryIds: string[],
  ): Promise<FeaturedCategory[]> => {
    try {
      await connectDB();

      if (source === "manual") {
        const ids = categoryIds.filter(Boolean);
        if (ids.length === 0) return [];

        const categories = await Category.find({
          isActive: true,
          _id: { $in: ids },
        })
          .select(CATEGORY_SELECT)
          .lean();

        // Preserve the admin-defined order.
        const order = new Map(ids.map((id, index) => [id, index]));
        return categories
          .map(mapCategory)
          .sort(
            (a, b) =>
              (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
              (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
          );
      }

      if (source === "topLevel") {
        const categories = await Category.find({
          isActive: true,
          parentId: null,
        })
          .select(CATEGORY_SELECT)
          .sort({ order: 1, name: 1 })
          .limit(limit)
          .lean();
        return categories.map(mapCategory);
      }

      // source === "featured": flagged categories, falling back to top-level
      // ones so the section is never empty.
      let categories = await Category.find({
        isActive: true,
        featured: true,
      })
        .select(CATEGORY_SELECT)
        .sort({ order: 1, name: 1 })
        .limit(limit)
        .lean();

      if (categories.length === 0) {
        categories = await Category.find({
          isActive: true,
          parentId: null,
        })
          .select(CATEGORY_SELECT)
          .sort({ order: 1, name: 1 })
          .limit(limit)
          .lean();
      }

      return categories.map(mapCategory);
    } catch {
      return [];
    }
  },
  ["home-featured-categories"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.categories],
  },
);

export async function HomeFeaturedCategories({
  locale,
  title,
  source,
  limit,
  categoryIds,
  emptyState = null,
}: HomeFeaturedCategoriesProps & { emptyState?: React.ReactNode }) {
  const categories = await fetchFeaturedCategories(source, limit, categoryIds);

  // Live storefronts stay silent; the admin preview names what is missing.
  if (categories.length === 0) return emptyState;

  return (
    <HomeFeaturedCategoriesClient
      locale={locale}
      title={title}
      categories={categories}
    />
  );
}
