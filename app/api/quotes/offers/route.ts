import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { isValidObjectId } from "@/lib/api/validate";
import { loadShopperOffers } from "@/lib/quotes/quote-offer";

/**
 * GET /api/quotes/offers?productId=… — the prices this shopper may buy this
 * product at, one entry per variant they have been quoted.
 *
 * The product page fetches it from the browser rather than resolving it while
 * rendering, and that is deliberate: storefront pages are cached and served to
 * everyone, so a quoted price baked into the HTML would be handed to every
 * visitor who happened to hit the same cache entry. A signed-out visitor gets
 * an empty list without a database read.
 */
export const GET = withApi(
  {
    auth: "optional",
    rateLimit: { action: "quotes:offers", preset: "lenient" },
  },
  async ({ request, session }) => {
    const productId = request.nextUrl.searchParams.get("productId") || "";
    if (!isValidObjectId(productId)) return successResponse([]);

    const offers = await loadShopperOffers(session?.user?.id, {
      productIds: [productId],
    });

    return successResponse(Array.from(offers.values()));
  },
);
