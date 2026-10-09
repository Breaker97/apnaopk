import { MeProduct } from "@/contracts/mobile/shop/v1/me";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { toMoney } from "@/lib/api-core/shop/money";
import { mongoose } from "@/lib/db";
import { reviewLimits } from "@/lib/api-core/shop/reviews/dto";
import { getReviewCopy } from "@/lib/catalog/review-copy";
import { resolveReviewEligibility } from "@/lib/catalog/review-eligibility";
import { isInWishlist } from "@/lib/customers/wishlist";
import { getStoreCurrency } from "@/lib/intl/server-currency";
import { loadShopperOffers } from "@/lib/quotes/quote-offer";

/**
 * GET /me/products/{id}: what of the product page is this shopper's own —
 * whether it is saved, whether they may review it, and the prices quoted to
 * them. The public page is cached for everybody, so none of this can be in
 * it (the website fetches its quoted prices from the browser for the same
 * reason: GET /api/quotes/offers).
 */
export const meProductRoute = defineRoute({
  id: "me.product",
  method: "GET",
  path: "/me/products/{id}",
  auth: "user",
  cache: { kind: "private" },
  output: MeProduct,
  handler: async ({ params, session, locale }) => {
    if (!mongoose.isValidObjectId(params.id)) {
      throw new MobileApiError(404, "NOT_FOUND", "Product not found.");
    }
    const userId = session.user.id;
    const [inWishlist, review, offers] = await Promise.all([
      isInWishlist(userId, params.id),
      resolveReviewEligibility(userId, params.id),
      loadShopperOffers(userId, { productIds: [params.id] }),
    ]);
    // Quoted in the store's currency, like every price the store sets.
    const currency = offers.size > 0 ? await getStoreCurrency() : null;
    const canReview = review.eligibleOrderId !== null;
    return {
      inWishlist,
      canReview,
      ...(canReview ? { reviewLimits: await reviewLimits(await getReviewCopy(locale)) } : {}),
      quoteOffers: currency
        ? [...offers.values()].map((offer) => ({
            quoteId: offer.quoteId,
            ...(offer.variantId ? { variantId: offer.variantId } : {}),
            unitPrice: toMoney(offer.unitPrice, currency),
            quantity: offer.quantity,
            ...(offer.expiresAt ? { expiresAt: offer.expiresAt } : {}),
            ...(offer.note?.trim() ? { note: offer.note.trim() } : {}),
          }))
        : [],
    };
  },
});
