import { ProductComparison, CompareQuery } from "@/contracts/mobile/shop/v1/compare";
import { defineRoute } from "@/lib/api-core/registry";
import type { ModernProduct } from "@/lib/products/modern-product";
import {
  buildCompareRows,
  compareAttributes,
  parseCompareSelection,
} from "@/lib/products/compare";
import { getStorefrontProductBySlug } from "@/lib/products/storefront-product-detail";
import { getStoreFacts } from "@/lib/storefront/store-facts";
import { catalogContext, toProductCard } from "./product-card";

/**
 * GET /compare: the website's comparison page (app/[locale]/(store)/compare),
 * for the products named in `?products=a,b,c`. The selection is read as the
 * page reads it (`parseCompareSelection`: de-duplicated in place, cut to the
 * most a comparison holds), each product comes from the product page's own
 * loader, and the specification rows are aligned by the page's own rule
 * (`buildCompareRows`), so the app's table says what the website's does. A slug
 * that no longer names a product drops out silently, as it does on the web.
 *
 * Per request, because the query is the shopper's; the same answer for every
 * shopper who sends it, so a CDN may keep it for a minute.
 */
export const compareRoute = defineRoute({
  id: "catalog.compare",
  method: "GET",
  path: "/compare",
  auth: "none",
  cache: { kind: "public", sMaxAge: 60, swr: 120 },
  etag: true,
  rateLimit: { bucket: "catalog:compare", preset: "browse" },
  input: CompareQuery,
  output: ProductComparison,
  handler: async ({ input, mobileApp }) => {
    const slugs = parseCompareSelection((input.products ?? []).join(","));
    const [loaded, facts] = await Promise.all([
      Promise.all(slugs.map((slug) => getStorefrontProductBySlug(slug))),
      getStoreFacts(),
    ]);
    const products = loaded.filter((product): product is NonNullable<typeof product> =>
      Boolean(product),
    );

    const ctx = catalogContext(facts, mobileApp);
    return {
      items: products.map((product) => toProductCard(product as unknown as ModernProduct, ctx)),
      rows: buildCompareRows(
        products.map((product) => ({ attributes: compareAttributes(product) })),
      ),
    };
  },
});
