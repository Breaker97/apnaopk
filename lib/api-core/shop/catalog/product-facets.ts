import {
  ProductFacets,
  ProductFacetsQuery,
  type PriceRange,
} from "@/contracts/mobile/shop/v1/catalog";
import { defineRoute } from "@/lib/api-core/registry";
import { resolveCurrency } from "@/lib/intl/currencies";
import {
  getStorefrontCategoryFacets,
  getStorefrontProductBrands,
  getStorefrontProductFilters,
  type StorefrontProductPriceRange,
} from "@/lib/products/storefront-product-filters";
import { getStoreFacts } from "@/lib/storefront/store-facts";
import { toMoney } from "../money";

/**
 * GET /products/facets: what the web's listings offer to narrow by, each from
 * the same cached reader. A category scopes them to its whole branch (price
 * and brands, as a category page offers); a seller to its own products
 * (categories, collections, price); neither, the whole catalogue. A category
 * wins when both are sent.
 */
export const productFacetsRoute = defineRoute({
  id: "catalog.products.facets",
  method: "GET",
  path: "/products/facets",
  auth: "none",
  cache: { kind: "public", sMaxAge: 60, swr: 120 },
  etag: true,
  rateLimit: { bucket: "catalog:facets", preset: "browse" },
  input: ProductFacetsQuery,
  output: ProductFacets,
  handler: async ({ input }) => {
    const facts = await getStoreFacts();
    const currency = resolveCurrency(facts.currencyCode);
    // Left out when the slider could not narrow anything (every price equal).
    const priceRange = (range: StorefrontProductPriceRange | null): { priceRange?: PriceRange } =>
      range && range.max > range.min
        ? {
            priceRange: {
              min: toMoney(range.min, currency),
              max: toMoney(range.max, currency),
              step: range.step,
            },
          }
        : {};

    if (input.category) {
      const facets = await getStorefrontCategoryFacets(input.category);
      return {
        categories: [],
        collections: [],
        brands: facets.brands,
        ...priceRange(facets.priceRange),
      };
    }

    const [filters, brands] = await Promise.all([
      getStorefrontProductFilters({ vendor: input.vendor }),
      // The brand facet is the whole catalogue's; a seller's page offers none.
      input.vendor ? [] : getStorefrontProductBrands(),
    ]);
    return {
      categories: filters.categories,
      collections: filters.collections,
      brands,
      ...priceRange(filters.priceRange),
    };
  },
});
