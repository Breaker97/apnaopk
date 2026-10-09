import { CreateReviewRequest, MyReview, REVIEW_REASONS } from "@/contracts/mobile/shop/v1/reviews";
import { defineRoute } from "@/lib/api-core/registry";
import { createCustomerReview } from "@/lib/catalog/customer-reviews";
import { getReviewCopy } from "@/lib/catalog/review-copy";
import { assertWithinLimits, toMyReview, toReviewError, uploadUrls } from "./dto";

/**
 * POST /products/{slug}/reviews: the shopper reviews a product delivered to
 * them, on the newest delivered order of it they have not reviewed yet: the
 * website's rules (a verified purchase, one per product per order). The
 * segment takes the product's id, or its slug. The photos are the shopper's
 * own uploads, named by id. A retry with the same `Idempotency-Key` answers
 * the review it wrote.
 */
export const createReviewRoute = defineRoute({
  id: "reviews.create",
  method: "POST",
  path: "/products/{slug}/reviews",
  auth: "user",
  cache: { kind: "private" },
  status: 201,
  rateLimit: { bucket: "reviews:create", preset: "moderate" },
  demo: "block-mutations",
  idempotency: "required",
  reasons: { values: REVIEW_REASONS },
  input: CreateReviewRequest,
  output: MyReview,
  handler: async ({ input, params, session, locale }) => {
    const uploadIds = input.uploadIds ?? [];
    assertWithinLimits({ title: input.title, text: input.text, photoCount: uploadIds.length });
    const [imageUrls, copy] = await Promise.all([
      uploadUrls(session.user.id, uploadIds, "uploadIds"),
      getReviewCopy(locale),
    ]);
    try {
      const review = await createCustomerReview({
        userId: session.user.id,
        product: params.slug,
        rating: input.rating,
        title: input.title,
        text: input.text,
        imageUrls,
      });
      return toMyReview(review, copy);
    } catch (error) {
      throw toReviewError(error);
    }
  },
});
