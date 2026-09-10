import { unstable_cache } from "next/cache";
import { type ModernProduct } from "@/components/products/modern-product-card";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { getCollectionProducts } from "@/lib/catalog/collections";
import { serializeProductCards } from "@/lib/products/storefront-product-cards";
import { connectDB } from "@/lib/db";
import { Collection } from "@/models";

const MAX_PRODUCTS = 12;

/**
 * By id rather than slug (the admin picker stores the stable id;
 * `getStorefrontCollectionDetail` keys by slug for URLs). Same guards and
 * tags as the detail fetcher: active + published to the online store.
 *
 * Exported so per-theme overrides of this section reuse the SAME cached
 * entry — a theme changes how a shelf looks, never how often it is queried.
 */
export const fetchCollectionShelf = unstable_cache(
  async (collectionId: string, limit: number) => {
    try {
      await connectDB();
      const collection = await Collection.findOne({
        _id: collectionId,
        status: "active",
      }).lean();
      if (!collection || !collection.publishing?.onlineStore) return null;

      const { products } = await getCollectionProducts(collection, {
        page: 1,
        limit: Math.min(limit, MAX_PRODUCTS),
        publishingChannel: "onlineStore",
        fields: "card",
      });
      if (products.length === 0) return null;

      return {
        title: collection.title,
        slug: collection.slug,
        products: serializeProductCards(products) as ModernProduct[],
      };
    } catch {
      return null;
    }
  },
  ["section-featured-collection"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.collections, CACHE_TAGS.products],
  },
);
