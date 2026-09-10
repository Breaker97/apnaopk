import { paginatedResponse, successResponse } from "@/lib/api/response";
import { getStorefrontCategories } from "@/lib/storefront/storefront-categories";
import { withApi } from "@/lib/api/handler";

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

    const result = await getStorefrontCategories({ flat, page, limit });

    if (flat) {
      return paginatedResponse(
        result.categories,
        result.pagination.page,
        result.pagination.limit,
        result.pagination.total,
      );
    }

    return successResponse(result.categories);
  },
);
