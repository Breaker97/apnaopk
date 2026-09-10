import { paginatedResponse, successResponse } from "@/lib/api/response";
import { getStorefrontBrands } from "@/lib/brands/storefront-brands";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/brands/public
 * Storefront brand listing with live product counts and optional pagination.
 */
export const GET = withApi(
  {},
  async ({ request }) => {
    const searchParams = request.nextUrl.searchParams;
    const flat = searchParams.get("flat") === "true";
    const rawPage = parseInt(searchParams.get("page") || "1", 10);
    const page = Number.isNaN(rawPage) ? 1 : Math.max(1, rawPage);
    const rawLimit = parseInt(searchParams.get("limit") || "20", 10);
    const limit = Math.min(
      50,
      Math.max(1, Number.isNaN(rawLimit) ? 20 : rawLimit),
    );

    const result = await getStorefrontBrands({ all: !flat, page, limit });

    if (flat) {
      return paginatedResponse(
        result.brands,
        result.pagination.page,
        result.pagination.limit,
        result.pagination.total,
      );
    }

    return successResponse(result.brands);
  },
);
