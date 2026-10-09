import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { STOREFRONT_BRAND_FILTER } from "@/lib/catalog/brands";
import { connectDB } from "@/lib/db";
import {
  collectIndexWords,
  type ProductSearchEntityIndex,
} from "@/lib/products/search";
import { Brand, Category } from "@/models";

/**
 * The names a search can resolve at query time: every live category (with
 * its parent, so a match can take its whole branch along) and every
 * storefront-visible brand, each reduced to its indexable words.
 *
 * Read on every search, so it is the smallest possible projection and cached
 * under the two tags a rename invalidates. Categories number in the hundreds
 * and brands likewise, so matching them in memory costs less than a query.
 */
export const getProductSearchEntityIndex = unstable_cache(
  async (): Promise<ProductSearchEntityIndex> => {
    await connectDB();

    const [categories, brands] = await Promise.all([
      Category.find({ isActive: true })
        .select("name parentId")
        .lean<{ _id: unknown; name?: string; parentId?: unknown }[]>(),
      Brand.find(STOREFRONT_BRAND_FILTER)
        .select("name")
        .lean<{ _id: unknown; name?: string }[]>(),
    ]);

    return {
      categories: categories.map((category) => ({
        id: String(category._id),
        parentId: category.parentId ? String(category.parentId) : null,
        words: collectIndexWords(category.name),
      })),
      brands: brands.map((brand) => ({
        id: String(brand._id),
        words: collectIndexWords(brand.name),
      })),
    };
  },
  ["product-search-entities"],
  { revalidate: 60, tags: [CACHE_TAGS.categories, CACHE_TAGS.brands] },
);
