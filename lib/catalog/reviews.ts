import mongoose from "mongoose";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { Product, Review } from "@/models";

/**
 * Recompute a product's average rating and review count from approved reviews.
 */
export async function recomputeProductRating(productId: string) {
  const stats = await Review.aggregate([
    {
      $match: {
        productId: new mongoose.Types.ObjectId(productId),
        isApproved: true,
      },
    },
    {
      $group: {
        _id: null,
        averageRating: { $avg: "$rating" },
        totalReviews: { $sum: 1 },
      },
    },
  ]);

  const { averageRating = 0, totalReviews = 0 } = stats[0] || {};

  const product = await Product.findByIdAndUpdate(
    productId,
    {
      rating: Math.round(averageRating * 10) / 10,
      reviewCount: totalReviews,
    },
    { new: true },
  )
    .select("slug")
    .lean();

  revalidateProductContent({ slugs: [product?.slug] });
}
