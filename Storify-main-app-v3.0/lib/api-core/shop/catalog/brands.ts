import { BrandList } from "@/contracts/mobile/shop/v1/catalog";
import { ListQuery, LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import { defineRoute } from "@/lib/api-core/registry";
import { getStorefrontBrands } from "@/lib/brands/storefront-brands";
import { nextPageCursor, pageFromCursor } from "../page-cursor";
import { toBrandSummary } from "./summaries";

/** GET /brands: the approved brands, in the store's order, as the web's brands page lists them. */
export const brandListRoute = defineRoute({
  id: "catalog.brands.list",
  method: "GET",
  path: "/brands",
  auth: "none",
  cache: { kind: "public", sMaxAge: 60, swr: 120 },
  etag: true,
  rateLimit: { bucket: "catalog:brands", preset: "browse" },
  input: ListQuery,
  output: BrandList,
  handler: async ({ input }) => {
    const page = pageFromCursor(input.cursor);
    const { brands, pagination } = await getStorefrontBrands({
      page,
      limit: input.limit ?? LIST_DEFAULT_LIMIT,
    });
    return {
      items: brands.map(toBrandSummary),
      nextCursor: nextPageCursor(page, pagination.totalPages),
    };
  },
});
