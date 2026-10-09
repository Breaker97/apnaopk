import { connectDB, mongoose } from "@/lib/db";
import { Review } from "@/models";

/**
 * A product's approved reviews, a page at a time, with the rating summary
 * over all of them. The web's `GET /api/reviews` and the app's
 * `GET /products/{slug}/reviews` answer from here.
 *
 * Read per request, not cached: an admin's reply or edit to a review expires
 * nothing, so a cached page would keep the old text for its whole lifetime.
 */

const REVIEW_SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  highest: { rating: -1, createdAt: -1 },
  lowest: { rating: 1, createdAt: -1 },
} satisfies Record<string, Record<string, 1 | -1>>;

export type ProductReviewSort = keyof typeof REVIEW_SORTS;

/** A requested order, else newest first. */
export function toReviewSort(value: string | null | undefined): ProductReviewSort {
  return value && Object.hasOwn(REVIEW_SORTS, value) ? (value as ProductReviewSort) : "newest";
}

export async function readProductReviews(input: {
  productId: string;
  page: number;
  limit: number;
  /** Only reviews with this many stars. */
  rating: number | null;
  sort: ProductReviewSort;
}) {
  const { productId, page, limit, rating } = input;
  await connectDB();

  const skip = (page - 1) * limit;
  const productObjectId = new mongoose.Types.ObjectId(productId);

  // Fetch the page of reviews and the rating breakdown in one round trip. The
  // aggregate already yields the total (totalReviews), so a separate
  // countDocuments over the same { productId, isApproved } set is redundant.
  const [reviews, stats] = await Promise.all([
    Review.find({
      productId,
      isApproved: true,
      ...(rating ? { rating } : {}),
    })
      .select(
        "rating title comment images isVerified createdAt reply.comment reply.createdAt reply.updatedAt userId",
      )
      .populate("userId", "name image")
      .sort(REVIEW_SORTS[input.sort])
      .skip(skip)
      .limit(limit)
      .lean(),
    Review.aggregate([
      {
        $match: {
          productId: productObjectId,
          isApproved: true,
        },
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 },
          rating5: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } },
          rating4: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
          rating3: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
          rating2: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
          rating1: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const ratingStats = stats[0] || {
    averageRating: 0,
    totalReviews: 0,
    rating5: 0,
    rating4: 0,
    rating3: 0,
    rating2: 0,
    rating1: 0,
  };

  // When a rating filter is active, the pagination total is that rating's
  // count (already computed in the histogram) — not the unfiltered total —
  // otherwise hasNext would be wrong. No extra query needed.
  const ratingCounts: Record<number, number> = {
    1: ratingStats.rating1,
    2: ratingStats.rating2,
    3: ratingStats.rating3,
    4: ratingStats.rating4,
    5: ratingStats.rating5,
  };
  const total = rating ? ratingCounts[rating] ?? 0 : ratingStats.totalReviews;
  const totalPages = Math.ceil(total / limit);

  return {
    reviews,
    stats: {
      average: Math.round(ratingStats.averageRating * 10) / 10,
      total: ratingStats.totalReviews as number,
      breakdown: {
        5: ratingStats.rating5 as number,
        4: ratingStats.rating4 as number,
        3: ratingStats.rating3 as number,
        2: ratingStats.rating2 as number,
        1: ratingStats.rating1 as number,
      },
    },
    pagination: {
      page,
      limit,
      total: total as number,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}
