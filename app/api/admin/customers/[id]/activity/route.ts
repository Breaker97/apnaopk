import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { CustomerProfile, Review, Wishlist } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { USER_ROLES } from "@/config/app.config";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/admin/customers/[id]/activity
 * Read-only engagement snapshot for the Activity tab: recent reviews and
 * wishlist size. `id` is the CustomerProfile id.
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    if (session.user.role !== USER_ROLES.ADMIN) {
      await assertAdminOrStaffPermissions(
        session as unknown as { user: { id: string; role: string } },
        [STAFF_PERMISSIONS.VIEW_CUSTOMERS],
      );
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:customers:activity",
      "lenient",
      session.user.role,
    );

    const { id } = params;
    if (!Types.ObjectId.isValid(id)) {
      return notFoundResponse("Customer");
    }

    await connectDB();

    const profile = await CustomerProfile.findById(id).select("userId").lean();
    if (!profile) {
      return notFoundResponse("Customer profile");
    }

    // Reviews and wishlists require an account, so a guest row (no userId)
    // has no activity to report — and stringifying its missing userId would
    // have sent the literal "undefined" into an ObjectId cast below.
    if (!profile.userId) {
      return successResponse({
        reviewCount: 0,
        wishlistCount: 0,
        recentReviews: [],
      });
    }

    const userId = String(profile.userId);

    const [reviews, reviewCount, wishlist] = await Promise.all([
      Review.find({ userId })
        .select("productId rating title comment isApproved createdAt")
        .populate({ path: "productId", select: "name title images slug" })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      Review.countDocuments({ userId }),
      // Wishlist.userId is stored as a String.
      Wishlist.findOne({ userId }).select("items").lean(),
    ]);

    const recentReviews = reviews.map((review) => {
      const product =
        review.productId && typeof review.productId === "object"
          ? (review.productId as {
              _id?: unknown;
              name?: string;
              title?: string;
              images?: string[];
            })
          : null;
      return {
        _id: String(review._id),
        productId: product?._id ? String(product._id) : null,
        productName: product?.title || product?.name || "Product",
        productImage: product?.images?.[0],
        rating: review.rating,
        title: review.title,
        comment: review.comment,
        isApproved: review.isApproved,
        createdAt: review.createdAt,
      };
    });

    return successResponse({
      reviewCount,
      wishlistCount: Array.isArray(wishlist?.items) ? wishlist.items.length : 0,
      recentReviews,
    });
  },
);
