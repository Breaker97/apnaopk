import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import {
  normalizeProductSearchMode,
  type ProductSearchMode,
} from "@/lib/products/search";

/**
 * The store's product search mode (`general.productSearchMode`), read the way
 * the other storefront settings are: one lean projection, cached under the
 * settings tag so a flip in the admin takes effect on the next request rather
 * than after the products cache's own window.
 */
export const getStorefrontSearchMode = unstable_cache(
  async (): Promise<ProductSearchMode> => {
    const { Settings } = await import("@/models/settings.model");
    const doc = await Settings.findOne()
      .select("general.productSearchMode")
      .lean<{ general?: { productSearchMode?: unknown } } | null>();
    return normalizeProductSearchMode(doc?.general?.productSearchMode);
  },
  ["storefront-search-mode"],
  { revalidate: 60, tags: [CACHE_TAGS.settings] },
);
