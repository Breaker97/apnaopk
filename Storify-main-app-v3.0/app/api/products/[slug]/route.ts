import { successResponse, notFoundResponse } from "@/lib/api/response";
import { getStorefrontProductBySlug } from "@/lib/products/storefront-product-detail";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/products/[slug]
 * Fetch a single product by slug
 */
export const GET = withApi<{ slug: string }>(
  {},
  async ({ params }) => {
    const { slug } = params;

    const product = await getStorefrontProductBySlug(slug);
    if (!product) {
      return notFoundResponse("Product");
    }

    return successResponse(product);
  },
);
