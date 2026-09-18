import { connectDB } from "@/lib/db";
import { Review } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { AdminUpdateReviewSchema } from "@/lib/validations";
import { auditUpdate, auditDelete, createAuditContext } from "@/lib/audit";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { recomputeProductRating } from "@/lib/catalog/reviews";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/admin/reviews/[id]
 * Get a single review.
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_REVIEWS, STAFF_PERMISSIONS.MANAGE_REVIEWS],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:reviews:read",
      "lenient",
      session.user.role,
    );

    await connectDB();

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Review");

    const review = await Review.findById(id)
      .populate("userId", "name email image")
      .populate("productId", "name slug images")
      .lean();

    if (!review) return notFoundResponse("Review");

    return successResponse(review);
  },
);

/**
 * PATCH /api/admin/reviews/[id]
 * Update a review (status, content, reply). Pass `reply: null` to clear it.
 */
export const PATCH = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.EDIT_REVIEWS, STAFF_PERMISSIONS.MANAGE_REVIEWS],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:reviews:update",
      "moderate",
      session.user.role,
    );

    await connectDB();

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Review");

    const body = await validateBody(request, AdminUpdateReviewSchema);

    const before = await Review.findById(id).lean();
    if (!before) return notFoundResponse("Review");

    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};

    if (body.isApproved !== undefined) set.isApproved = body.isApproved;
    if (body.rating !== undefined) set.rating = body.rating;
    if (body.title !== undefined) set.title = body.title;
    if (body.comment !== undefined) set.comment = body.comment;

    if (body.reply === null) {
      unset.reply = "";
    } else if (typeof body.reply === "string") {
      set.reply = {
        comment: body.reply,
        userId: session.user.id,
      };
    }

    const update: Record<string, unknown> = {};
    if (Object.keys(set).length > 0) update.$set = set;
    if (Object.keys(unset).length > 0) update.$unset = unset;

    const review = await Review.findByIdAndUpdate(id, update, {
      returnDocument: "after",
      runValidators: true,
    })
      .populate("userId", "name email image")
      .populate("productId", "name slug images")
      .lean();

    if (!review) return notFoundResponse("Review");

    // If approval state or rating changed, recompute the product rating cache.
    const approvalChanged =
      body.isApproved !== undefined && body.isApproved !== before.isApproved;
    const ratingChanged =
      body.rating !== undefined && body.rating !== before.rating;
    if (approvalChanged || ratingChanged) {
      await recomputeProductRating(String(before.productId));
    }

    const auditContext = createAuditContext(request, session);
    await auditUpdate(
      auditContext,
      "review",
      id,
      before as unknown as Record<string, unknown>,
      review as unknown as Record<string, unknown>,
    );

    return successResponse(review);
  },
);

/**
 * DELETE /api/admin/reviews/[id]
 * Hard-delete a review.
 */
export const DELETE = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.DELETE_REVIEWS, STAFF_PERMISSIONS.MANAGE_REVIEWS],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:reviews:delete",
      "moderate",
      session.user.role,
    );

    await connectDB();

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Review");

    const before = await Review.findById(id).lean();
    if (!before) return notFoundResponse("Review");

    await Review.findByIdAndDelete(id);

    await recomputeProductRating(String(before.productId));

    const auditContext = createAuditContext(request, session);
    await auditDelete(
      auditContext,
      "review",
      id,
      before as unknown as Record<string, unknown>,
    );

    return successResponse({ message: "Review deleted" });
  },
);
