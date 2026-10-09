import { MyReview, REVIEW_REASONS, UpdateReviewRequest } from "@/contracts/mobile/shop/v1/reviews";
import { defineRoute } from "@/lib/api-core/registry";
import { updateCustomerReview } from "@/lib/catalog/customer-reviews";
import { getReviewCopy } from "@/lib/catalog/review-copy";
import { assertWithinLimits, resolvePhotoIds, toMyReview, toReviewError } from "./dto";

/**
 * PATCH /me/reviews/{id}: the shopper changes their own review within the
 * same limits as writing it. A review the store took down stays as it is
 * (NOT_EDITABLE).
 */
export const updateReviewRoute = defineRoute({
  id: "me.reviews.update",
  method: "PATCH",
  path: "/me/reviews/{id}",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "reviews:update", preset: "moderate" },
  demo: "block-mutations",
  reasons: { values: REVIEW_REASONS },
  input: UpdateReviewRequest,
  output: MyReview,
  handler: async ({ input, params, session, locale }) => {
    assertWithinLimits({
      title: input.title,
      text: input.text,
      photoCount: input.photoIds?.length,
    });
    const copy = await getReviewCopy(locale);
    try {
      const review = await updateCustomerReview({
        userId: session.user.id,
        reviewId: params.id,
        ...(input.rating !== undefined ? { rating: input.rating } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.photoIds !== undefined ? { imageUrls: resolvePhotoIds(session.user.id, input.photoIds) } : {}),
      });
      return toMyReview(review, copy);
    } catch (error) {
      throw toReviewError(error);
    }
  },
});
