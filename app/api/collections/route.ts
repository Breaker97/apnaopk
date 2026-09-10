import { NextRequest } from "next/server";
import { paginatedResponse } from "@/lib/api/response";
import { handleApiError } from "@/lib/api/errors";
import { rateLimitByIP } from "@/lib/api/rate-limit-middleware";
import { getStorefrontCollections } from "@/lib/storefront/storefront-collections";
import { z } from "zod";

const CollectionPublicQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(24),
  channel: z.enum(["onlineStore", "pointOfSale"]).optional(),
});

/**
 * GET /api/collections
 * Get all active collections for storefront
 */
export async function GET(request: NextRequest) {
  try {
    await rateLimitByIP(request, "lenient");
    const { searchParams } = new URL(request.url);

    const params = CollectionPublicQuerySchema.parse({
      page: searchParams.get("page") || 1,
      limit: searchParams.get("limit") || 24,
      channel: searchParams.get("channel") || undefined,
    });

    const result = await getStorefrontCollections(params);

    return paginatedResponse(
      result.data,
      result.pagination.page,
      result.pagination.limit,
      result.pagination.total,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
