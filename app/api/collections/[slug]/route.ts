import { successResponse, notFoundResponse } from "@/lib/api/response";
import { getStorefrontCollectionDetail } from "@/lib/storefront/storefront-collections";
import { z } from "zod";
import type { CollectionSortOrder } from "@/types";
import { withApi } from "@/lib/api/handler";

const CollectionProductsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(24),
  sort: z
    .enum([
      "manual",
      "best-selling",
      "title-asc",
      "title-desc",
      "price-asc",
      "price-desc",
      "created-asc",
      "created-desc",
    ])
    .optional(),
  channel: z.enum(["onlineStore", "pointOfSale"]).optional(),
  // No location params: a shopper's location is a lens on the storefront, not a
  // filter, so it never changes which products a collection holds.
});

/**
 * GET /api/collections/[slug]
 * Get a collection with its products by slug
 */
export const GET = withApi<{ slug: string }>(
  {},
  async ({ request, params }) => {
    const { searchParams } = new URL(request.url);
    const { slug } = params;

    const queryParams = CollectionProductsQuerySchema.parse({
      page: searchParams.get("page") || 1,
      limit: searchParams.get("limit") || 24,
      sort: searchParams.get("sort") || undefined,
      channel: searchParams.get("channel") || undefined,
    });

    const data = await getStorefrontCollectionDetail({
      slug,
      page: queryParams.page,
      limit: queryParams.limit,
      channel: queryParams.channel,
      sort: queryParams.sort as CollectionSortOrder | undefined,
    });

    if (!data) return notFoundResponse("Collection");

    return successResponse(data);
  },
);
