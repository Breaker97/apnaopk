import { successResponse } from "@/lib/api/response";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { validateQuery } from "@/lib/api/validate";
import { AdminReviewListQuerySchema } from "@/lib/validations";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { withApi } from "@/lib/api/handler";
import { fetchAdminReviewList } from "@/lib/catalog/review-list";

/**
 * GET /api/admin/reviews
 * Paginated, filtered review list for the admin table. The rating summary shown
 * above the table is computed by the RSC page itself, not here.
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_REVIEWS, STAFF_PERMISSIONS.MANAGE_REVIEWS],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:reviews:list",
      "lenient",
      session.user.role,
    );

    const {
      page,
      limit,
      search,
      status,
      rating,
      productId,
      hasReply,
      view,
      sortBy,
      sortOrder,
    } = validateQuery(request, AdminReviewListQuerySchema);

    const list = await fetchAdminReviewList({
      page,
      limit,
      search,
      status,
      rating,
      productId,
      hasReply,
      view,
      sortBy,
      sortOrder,
    });

    return successResponse({
      data: list.items,
      pagination: {
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
        hasNext: list.page < list.totalPages,
        hasPrev: list.page > 1,
      },
    });
  },
);
