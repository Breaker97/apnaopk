import "server-only";

import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import {
  automatedCollectionRules,
  productsJoiningByRule,
  type CollectionRules,
} from "@/lib/catalog/collections";
import { connectDB } from "@/lib/db";
import { finalSaleCollectionIdsOf } from "@/lib/returns/final-sale";
import { returnWindowOverridesOf } from "@/lib/returns/return-window";
import { withFallback } from "@/lib/storefront/cached-read";
import { getSettingsLean } from "@/models/settings.model";

type ReturnCollections = {
  /** The store's final-sale collections. */
  finalSale: string[];
  /**
   * The automated collections among the final-sale and return-window ones,
   * with their rules: a product joins those by matching, never by listing
   * them itself (`ruleCollectionsOf`).
   */
  rules: CollectionRules[];
};

/**
 * The collections the store's return settings name, cached under the
 * settings and collections tags like every other storefront reader: saving
 * the returns settings, or a collection's rules, expires it.
 *
 * The cart asks on every call, and every page load calls the cart. In a route
 * handler `cache()` shares nothing, so reading the settings — and then the
 * collections' rules — there added database round trips, after the cart's own
 * reads, to each of them.
 *
 * Throws when the read fails. The product page wants that: a failed render
 * keeps serving the page it had, where a fallback would be kept as the page.
 */
export const getReturnCollections = unstable_cache(
  async (): Promise<ReturnCollections> => {
    await connectDB();
    const settings = await getSettingsLean();
    const finalSale = finalSaleCollectionIdsOf(settings);
    const windows = returnWindowOverridesOf(settings).map((entry) => entry.collectionId);
    return {
      finalSale,
      rules: await automatedCollectionRules([...finalSale, ...windows]),
    };
  },
  ["return-collections"],
  { revalidate: 60, tags: [CACHE_TAGS.settings, CACHE_TAGS.collections] },
);

/** What the cart needs to mark its lines final sale by collection. */
export type CartFinalSale = {
  /** The store's final-sale collections. */
  collectionIds: string[];
  /** The final-sale collections each product joins by their rules. */
  byRule: Map<string, string[]>;
};

/**
 * The cart's final-sale collections, and which of its products join an
 * automated one by its rules. Nothing to match — the usual store — costs no
 * query; otherwise one per automated collection, over the cart's products,
 * alongside the cart's own product read.
 *
 * A failed read marks no line final sale by collection. The order re-reads
 * the settings and the rules when it is placed, so the line is still sold as
 * final sale; only the cart's early notice is missed.
 */
export const readCartFinalSale = withFallback(
  async (productIds: ReadonlyArray<unknown>): Promise<CartFinalSale> => {
    const { finalSale, rules } = await getReturnCollections();
    const named = new Set(finalSale);
    return {
      collectionIds: finalSale,
      byRule: await productsJoiningByRule(
        productIds,
        rules.filter((rule) => named.has(rule.id)),
      ),
    };
  },
  (): CartFinalSale => ({ collectionIds: [], byRule: new Map() }),
);
