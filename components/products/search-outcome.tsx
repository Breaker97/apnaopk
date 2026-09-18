import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { GridResultQuery } from "@/components/products/grid-result-count";
import { getClientIP } from "@/lib/api/rate-limit-middleware";
import { getStorefrontProducts } from "@/lib/products/storefront-products";
import {
  hasNarrowingFacet,
  recordZeroResultSearch,
} from "@/lib/products/zero-result-searches";
import { cn } from "@/lib/utils";

/**
 * What a search on a listing page came to, said once above its grid.
 *
 * - A misspelt search answered with corrected words says so: "Showing
 *   results for iphone". Without it a shopper who typed "ipone" sees
 *   iPhones and cannot tell whether the store understood them.
 * - A search that found nothing at all — with no filter to blame — is
 *   counted for the admin's Search insights report.
 *
 * Reads the grid's own query with nothing changed, so this is the grid's
 * cache entry rather than a second search. Renders nothing for a listing
 * that is not a search.
 */
export async function SearchOutcome({
  locale,
  gridQuery,
  className,
}: {
  locale: string;
  gridQuery: GridResultQuery;
  className?: string;
}) {
  if (!gridQuery.search?.trim()) return null;

  let result: Awaited<ReturnType<typeof getStorefrontProducts>>;
  try {
    result = await getStorefrontProducts({ ...gridQuery, cardFieldsOnly: true });
  } catch {
    // The grid renders its own failure; an annotation never adds a second.
    return null;
  }

  const firstPage = (gridQuery.page ?? 1) <= 1;
  if (
    firstPage &&
    result.pagination.total === 0 &&
    !hasNarrowingFacet({
      category: gridQuery.category,
      collection: gridQuery.collection,
      brand: gridQuery.brand,
      vendor: gridQuery.vendor,
      minPrice: gridQuery.minPrice,
      maxPrice: gridQuery.maxPrice,
      preorder: gridQuery.preorder,
      pickupNearby: gridQuery.pickupNearby,
      inStock: gridQuery.inStock,
      outOfStock: gridQuery.outOfStock,
    })
  ) {
    recordZeroResultSearch({
      query: gridQuery.search,
      source: "storefront",
      clientKey: getClientIP({ headers: await headers() }),
    });
  }

  if (!result.searchCorrection || result.pagination.total === 0) return null;
  const t = await getTranslations({ locale });
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      {t.rich("common.showingResultsFor", {
        query: result.searchCorrection.to,
        q: (chunks) => (
          <strong className="font-semibold text-foreground">{chunks}</strong>
        ),
      })}
    </p>
  );
}
