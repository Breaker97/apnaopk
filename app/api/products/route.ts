import { paginatedResponse } from "@/lib/api/response";
import { rateLimitByIP } from "@/lib/api/rate-limit-middleware";
import { getStorefrontProducts } from "@/lib/products/storefront-products";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/products
 * Fetch products with filtering, sorting, and pagination.
 */
export const GET = withApi(
  {},
  async ({ request }) => {
    await rateLimitByIP(request, "lenient");

    const searchParams = request.nextUrl.searchParams;
    const result = await getStorefrontProducts({
      page: searchParams.get("page"),
      limit: searchParams.get("limit"),
      vendor: searchParams.get("vendor"),
      tag: searchParams.get("tag"),
      search: searchParams.get("search"),
      minPrice: searchParams.get("minPrice"),
      maxPrice: searchParams.get("maxPrice"),
      status: searchParams.get("status"),
      featured: searchParams.get("featured"),
      preorder: searchParams.get("preorder"),
      sortBy: searchParams.get("sortBy"),
      sortOrder: searchParams.get("sortOrder"),
      category: searchParams.getAll("category"),
      collection: searchParams.getAll("collection"),
      brand: searchParams.getAll("brand"),
      onSale: searchParams.get("onSale"),
      ids: searchParams.get("ids"),
      minRating: searchParams.get("minRating"),
      inStock: searchParams.get("inStock"),
      // Shopper location. Resolved to the vendors at that place before the
      // product query runs — products have no location of their own.
      lat: searchParams.get("lat"),
      lng: searchParams.get("lng"),
      radius: searchParams.get("radius"),
      city: searchParams.get("city"),
      // "Pickup near me". Read here too, or the client-side radius counter and
      // the server-rendered grid would answer against different result sets.
      pickupNearby: searchParams.get("pickup"),
      // Opt-in: storefront card grids/search pass this to receive only the
      // fields a product card renders (PRODUCT_CARD_SELECT) instead of full,
      // variant/media-heavy documents. Admin callers omit it and get full docs.
      cardFieldsOnly: searchParams.get("cardFieldsOnly") === "true",
    });

    return paginatedResponse(
      result.data,
      result.pagination.page,
      result.pagination.limit,
      result.pagination.total,
    );
  },
);
