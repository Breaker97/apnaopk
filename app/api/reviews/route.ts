import { connectDB, mongoose } from "@/lib/db";
import { Review, Product, Order } from "@/models";
import { successResponse } from "@/lib/api/response";
import { AuthenticationError, ValidationError } from "@/lib/api/errors";
import { rateLimitByIP, rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { recomputeProductRating } from "@/lib/catalog/reviews";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

// Server-side sort options for the reviews list. Rating-led sorts fall back to
// createdAt so equal ratings keep a stable, newest-first order.
const REVIEW_SORTS: Record<string, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  highest: { rating: -1, createdAt: -1 },
  lowest: { rating: 1, createdAt: -1 },
};

const CreateReviewBodySchema = z.object({
  productId: z
    .string({ error: "Product ID is required" })
    .min(1, "Product ID is required"),
  orderId: z
    .string({ error: "Order ID is required" })
    .min(1, "Order ID is required"),
  rating: z.coerce
    .number({ error: "Rating must be between 1 and 5" })
    .min(1, "Rating must be between 1 and 5")
    .max(5, "Rating must be between 1 and 5"),
  title: z.string().trim().max(200).optional(),
  comment: z
    .string({ error: "Comment must be at least 10 characters" })
    .min(10, "Comment must be at least 10 characters"),
  images: z.array(z.string().max(2048)).max(10).optional(),
});

/**
 * GET /api/reviews
 * Get reviews for a product
 */
export const GET = withApi(
  {},
  async ({ request }) => {
    await rateLimitByIP(request, "lenient");
    await connectDB();

    const productId = request.nextUrl.searchParams.get("productId");
    // Clamp pagination: an unbounded limit lets an anonymous caller pull every
    // review for a product in one request (and blows up the populate/serialize
    // cost). Page is floored at 1.
    const page = Math.max(
      1,
      parseInt(request.nextUrl.searchParams.get("page") || "1", 10) || 1,
    );
    const limit = Math.min(
      50,
      Math.max(
        1,
        parseInt(request.nextUrl.searchParams.get("limit") || "10", 10) || 10,
      ),
    );
    // Optional star-rating filter (1-5) and sort — applied at the DB layer so
    // filtering/sorting spans ALL reviews, not just the page(s) already loaded
    // client-side.
    const ratingParam = request.nextUrl.searchParams.get("rating");
    const ratingFilter =
      ratingParam && /^[1-5]$/.test(ratingParam) ? Number(ratingParam) : null;
    const reviewSort =
      REVIEW_SORTS[request.nextUrl.searchParams.get("sort") || "newest"] ??
      REVIEW_SORTS.newest;

    if (!productId) {
      throw new ValidationError({ productId: ["Product ID is required"] });
    }
    // Validate before constructing an ObjectId — an invalid id would otherwise
    // throw a BSONError and surface as a 500 instead of a clean 400.
    if (!mongoose.isValidObjectId(productId)) {
      throw new ValidationError({ productId: ["Invalid product ID"] });
    }

    const skip = (page - 1) * limit;
    const productObjectId = new mongoose.Types.ObjectId(productId);

    // Fetch the page of reviews and the rating breakdown in one round trip. The
    // aggregate already yields the total (totalReviews), so a separate
    // countDocuments over the same { productId, isApproved } set is redundant.
    const [reviews, stats] = await Promise.all([
      Review.find({
        productId,
        isApproved: true,
        ...(ratingFilter ? { rating: ratingFilter } : {}),
      })
        .select(
          "rating title comment images isVerified createdAt reply.comment reply.createdAt reply.updatedAt userId",
        )
        .populate("userId", "name image")
        .sort(reviewSort)
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
    const total = ratingFilter
      ? ratingCounts[ratingFilter] ?? 0
      : ratingStats.totalReviews;
    const totalPages = Math.ceil(total / limit);

    return successResponse({
      reviews,
      stats: {
        average: Math.round(ratingStats.averageRating * 10) / 10,
        total: ratingStats.totalReviews,
        breakdown: {
          5: ratingStats.rating5,
          4: ratingStats.rating4,
          3: ratingStats.rating3,
          2: ratingStats.rating2,
          1: ratingStats.rating1,
        },
      },
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  },
);

/**
 * POST /api/reviews
 * Create a new review (requires purchase)
 */
export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    if (!session) {
      await rateLimitByIP(request, "moderate");
      throw new AuthenticationError();
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "reviews:create",
      "moderate",
      session.user.role,
    );

    await connectDB();

    const { productId, orderId, rating, title, comment, images } =
      await validateBody(request, CreateReviewBodySchema);

    // Verify product exists
    const product = await Product.findById(productId);
    if (!product) {
      throw new ValidationError({ productId: ["Product not found"] });
    }

    // Verify order exists and belongs to user, and contains the product
    const order = await Order.findOne({
      _id: orderId,
      customerId: session.user.id,
      "items.productId": productId,
      status: { $in: ["delivered", "completed"] },
    });

    if (!order) {
      throw new ValidationError({
        orderId: ["You can only review products from completed orders"],
      });
    }

    // Check if already reviewed
    const existingReview = await Review.findOne({
      productId,
      userId: session.user.id,
      orderId,
    });

    if (existingReview) {
      throw new ValidationError({
        review: ["You have already reviewed this product for this order"],
      });
    }

    // Create review
    const review = await Review.create({
      productId,
      userId: session.user.id,
      orderId,
      rating,
      title: title || "",
      comment,
      images: images || [],
      isVerified: true, // Verified purchase
      isApproved: true, // Auto-approve for now
    });

    // Update product rating
    await recomputeProductRating(productId);

    // Update customer profile stats (fire-and-forget)
    import("@/lib/customers/customer")
      .then(({ refreshCustomerStats }) =>
        refreshCustomerStats(session.user.id),
      )
      .catch((err) =>
        console.error("Failed to refresh customer stats:", err),
      );

    return successResponse(review, "Review created successfully", 201);
  },
);
