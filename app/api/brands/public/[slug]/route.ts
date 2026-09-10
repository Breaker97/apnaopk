import { successResponse, notFoundResponse } from "@/lib/api/response";
import { getStorefrontBrandDetail } from "@/lib/brands/storefront-brands";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";

const BrandProductsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(24),
  sort: z
    .enum([
      "featured",
      "best-selling",
      "title-asc",
      "title-desc",
      "price-asc",
      "price-desc",
      "created-desc",
    ])
    .optional(),
  // No location params: a shopper's location is a lens on the storefront, not a
  // filter, so it never changes which products carry a brand.
});

/**
 * GET /api/brands/public/[slug]
 * Storefront brand detail with its visible products (paginated + sorted).
 */
export const GET = withApi<{ slug: string }>(
  {},
  async ({ request, params }) => {
    const { searchParams } = new URL(request.url);
    const { slug } = params;

    const { page, limit, sort } = BrandProductsQuerySchema.parse({
      page: searchParams.get("page") || 1,
      limit: searchParams.get("limit") || 24,
      sort: searchParams.get("sort") || undefined,
    });

    const data = await getStorefrontBrandDetail({ slug, page, limit, sort });

    if (!data) return notFoundResponse("Brand");

    return successResponse(data);
  },
);
