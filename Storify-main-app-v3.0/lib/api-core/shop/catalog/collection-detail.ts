import { CollectionDetail } from "@/contracts/mobile/shop/v1/catalog";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { getStorefrontCollectionDetail } from "@/lib/storefront/storefront-collections";
import { toCollectionSummary } from "./summaries";

/**
 * GET /collections/{slug}: the collection's own page header. Its products
 * come from `GET /products?collection=`, in the collection's order; the two
 * can be asked for at once. Static: expired by the collections and products
 * tags.
 */
export const collectionDetailRoute = defineRoute({
  id: "catalog.collections.detail",
  method: "GET",
  path: "/collections/{slug}",
  auth: "none",
  cache: { kind: "static", revalidate: 60 },
  output: CollectionDetail,
  handler: async ({ params }) => {
    // One product is the least the reader pages by; only its count is used.
    const detail = await getStorefrontCollectionDetail({ slug: params.slug, page: 1, limit: 1 });
    if (!detail) throw new MobileApiError(404, "NOT_FOUND", "This collection is not available.");
    const { collection } = detail;
    const description = collection.description?.trim();
    return {
      ...toCollectionSummary(collection),
      ...(description ? { description } : {}),
    };
  },
});
