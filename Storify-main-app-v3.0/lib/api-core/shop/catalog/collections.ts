import { CollectionList } from "@/contracts/mobile/shop/v1/catalog";
import { ListQuery, LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import { defineRoute } from "@/lib/api-core/registry";
import { getStorefrontCollections } from "@/lib/storefront/storefront-collections";
import { nextPageCursor, pageFromCursor } from "../page-cursor";
import { toCollectionSummary } from "./summaries";

/** GET /collections: what the web's collections page lists, in its order. */
export const collectionListRoute = defineRoute({
  id: "catalog.collections.list",
  method: "GET",
  path: "/collections",
  auth: "none",
  cache: { kind: "public", sMaxAge: 60, swr: 120 },
  etag: true,
  rateLimit: { bucket: "catalog:collections", preset: "browse" },
  input: ListQuery,
  output: CollectionList,
  handler: async ({ input }) => {
    const page = pageFromCursor(input.cursor);
    const { data, pagination } = await getStorefrontCollections({
      page,
      limit: input.limit ?? LIST_DEFAULT_LIMIT,
    });
    return {
      items: data.map(toCollectionSummary),
      nextCursor: nextPageCursor(page, pagination.totalPages),
    };
  },
});
