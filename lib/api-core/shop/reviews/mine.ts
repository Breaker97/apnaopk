import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import { MyReviewList, MyReviewListQuery, WaitingReviews } from "@/contracts/mobile/shop/v1/reviews";
import { defineRoute } from "@/lib/api-core/registry";
import { imageSet } from "@/lib/api-core/shop/images";
import { nextPageCursor, pageFromCursor } from "@/lib/api-core/shop/page-cursor";
import { listCustomerReviews } from "@/lib/catalog/customer-reviews";
import { getReviewCopy } from "@/lib/catalog/review-copy";
import { listPendingReviews } from "@/lib/catalog/review-eligibility";
import { connectDB } from "@/lib/db";
import { reviewLimits, toMyReview } from "./dto";

/** GET /me/reviews: the shopper's own reviews, newest first, with the limits to edit within. */
export const myReviewsRoute = defineRoute({
  id: "me.reviews.list",
  method: "GET",
  path: "/me/reviews",
  auth: "user",
  cache: { kind: "private" },
  etag: true,
  input: MyReviewListQuery,
  output: MyReviewList,
  handler: async ({ input, session, locale }) => {
    const page = pageFromCursor(input.cursor);
    const copy = await getReviewCopy(locale);
    const [{ reviews, totalPages }, limits] = await Promise.all([
      listCustomerReviews({
        userId: session.user.id,
        page,
        limit: input.limit ?? LIST_DEFAULT_LIMIT,
        ...(input.rating ? { rating: input.rating } : {}),
      }),
      reviewLimits(copy),
    ]);
    return {
      items: reviews.map((review) => toMyReview(review, copy)),
      nextCursor: nextPageCursor(page, totalPages),
      limits,
    };
  },
});

/** The most products GET /me/reviews/waiting lists. */
const WAITING_LIMIT = 20;

/**
 * GET /me/reviews/waiting: what the website's account page asks the shopper
 * to rate (`listPendingReviews`): products delivered to them, not reviewed
 * on any order, still on sale; the most recent delivery first.
 */
export const waitingReviewsRoute = defineRoute({
  id: "me.reviews.waiting",
  method: "GET",
  path: "/me/reviews/waiting",
  auth: "user",
  cache: { kind: "private" },
  etag: true,
  output: WaitingReviews,
  handler: async ({ session, locale }) => {
    await connectDB();
    const copy = await getReviewCopy(locale);
    const [pending, limits] = await Promise.all([
      listPendingReviews(session.user.id, { limit: WAITING_LIMIT }),
      reviewLimits(copy),
    ]);
    return {
      items: pending.map((item) => {
        const image = imageSet(item.image, item.name);
        return {
          product: {
            id: item.productId,
            ...(item.slug ? { slug: item.slug } : {}),
            name: item.name,
            ...(image ? { image } : {}),
          },
          orderId: item.orderId,
          orderNumber: item.orderNumber,
          ...(item.deliveredAt ? { deliveredAt: new Date(item.deliveredAt).toISOString() } : {}),
        };
      }),
      limits,
    };
  },
});
