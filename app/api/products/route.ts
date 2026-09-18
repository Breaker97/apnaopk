import { paginatedResponse } from "@/lib/api/response";
import { getClientIP, rateLimitByIP } from "@/lib/api/rate-limit-middleware";
import { getStorefrontProducts } from "@/lib/products/storefront-products";
import {
  hasNarrowingFacet,
  recordZeroResultSearch,
} from "@/lib/products/zero-result-searches";
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
    const facets = {
      vendor: searchParams.get("vendor"),
      tag: searchParams.get("tag"),
      minPrice: searchParams.get("minPrice"),
      maxPrice: searchParams.get("maxPrice"),
      featured: searchParams.get("featured"),
      preorder: searchParams.get("preorder"),
      category: searchParams.getAll("category"),
      collection: searchParams.getAll("collection"),
      brand: searchParams.getAll("brand"),
      onSale: searchParams.get("onSale"),
      ids: searchParams.get("ids"),
      minRating: searchParams.get("minRating"),
      inStock: searchParams.get("inStock"),
      // "Pickup near me". Read here too, or the client-side radius counter and
      // the server-rendered grid would answer against different result sets.
      pickupNearby: searchParams.get("pickup"),
    };
    const search = searchParams.get("search");
    const result = await getStorefrontProducts({
      ...facets,
      page: searchParams.get("page"),
      limit: searchParams.get("limit"),
      search,
      status: searchParams.get("status"),
      sortBy: searchParams.get("sortBy"),
      sortOrder: searchParams.get("sortOrder"),
      // Shopper location. Resolved to the vendors at that place before the
      // product query runs — products have no location of their own.
      lat: searchParams.get("lat"),
      lng: searchParams.get("lng"),
      radius: searchParams.get("radius"),
      city: searchParams.get("city"),
      // Opt-in: storefront card grids/search pass this to receive only the
      // fields a product card renders (PRODUCT_CARD_SELECT) instead of full,
      // variant/media-heavy documents. Admin callers omit it and get full docs.
      cardFieldsOnly: searchParams.get("cardFieldsOnly") === "true",
    });

    // The header search box answers through here as the shopper types. A
    // first page with no filter that found nothing is a product the store
    // does not have — the admin's Search insights report counts it.
    if (
      search &&
      result.pagination.page === 1 &&
      result.pagination.total === 0 &&
      !hasNarrowingFacet(facets)
    ) {
      recordZeroResultSearch({
        query: search,
        source: "storefront",
        clientKey: getClientIP(request),
      });
    }

    return paginatedResponse(
      result.data,
      result.pagination.page,
      result.pagination.limit,
      result.pagination.total,
      result.searchCorrection
        ? { searchCorrection: result.searchCorrection }
        : undefined,
    );
  },
);
