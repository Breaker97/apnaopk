import type { ReactNode } from "react";
import { getStorefrontProducts } from "@/lib/products/storefront-products";

/**
 * The grid's query, verbatim. Any divergence from what `<ProductGrid>`
 * receives both misses the cache and reports a total for a different set of
 * products than the shopper is looking at.
 */
export interface GridResultQuery {
  category?: string;
  collection?: string;
  brand?: string;
  vendor?: string;
  search?: string;
  minPrice?: string;
  maxPrice?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: number;
  limit?: number;
  preorder?: boolean;
  lat?: string;
  lng?: string;
  radius?: string;
  city?: string;
  pickupNearby?: string;
  inStock?: boolean;
  outOfStock?: boolean;
}

/**
 * How many products the grid beside a filter rail is showing.
 *
 * The query is deliberately the grid's own query with nothing changed — the
 * storefront cache is keyed on the normalized arguments, so passing exactly
 * what the grid passes reads its cache entry instead of running a second
 * count. `undefined` when the query fails: the grid renders its own failure,
 * and the sidebar simply omits the number rather than taking the page down
 * for an annotation.
 */
export async function countGridResults(
  gridQuery: GridResultQuery,
): Promise<number | undefined> {
  try {
    const result = await getStorefrontProducts({
      ...gridQuery,
      cardFieldsOnly: true,
    });
    return result.pagination?.total;
  } catch {
    return undefined;
  }
}

/**
 * Render a filter rail with the grid's result total resolved for it.
 *
 * A server component of its own so the count can be awaited inside a Suspense
 * boundary: the rail is rendered in the page shell, above and beside the grid,
 * and awaiting a query there would hold back the whole page for a number that
 * only annotates one group in the sidebar. The fallback is the same rail
 * without the number.
 */
export async function WithGridResultCount({
  gridQuery,
  children,
}: {
  gridQuery: GridResultQuery;
  children: (resultCount: number | undefined) => ReactNode;
}) {
  return <>{children(await countGridResults(gridQuery))}</>;
}
