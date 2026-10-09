import { Order, OrderComment } from "@/models";
import {
  buildCommentAudienceFilter,
  NOT_DELETED_ORDER_COMMENT_FILTER,
} from "@/models/order-comment.model";
import { withApi } from "@/lib/api/handler";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { OrderCommentSchema } from "@/lib/validations";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { AuthorizationError } from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import type { StaffPermission } from "@/config/permissions.config";
import {
  buildStaffOrderScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";

/** A full admin arrives with no `permissions` array — that means "all of them". */
function hasStaffPermission(
  permissions: StaffPermission[] | undefined,
  permission: StaffPermission,
) {
  return !permissions || permissions.includes(permission);
}

/**
 * Resolve a comment through its order, applying the caller's staff scope.
 *
 * The comment is looked up by BOTH its own id and the order id from the URL,
 * so a comment id belonging to another order cannot be reached by pairing it
 * with an order this caller happens to be allowed to see.
 */
async function loadScopedComment(
  orderId: string,
  commentId: string,
  scope: Parameters<typeof buildStaffOrderScopeFilter>[0],
) {
  if (!isValidObjectId(orderId) || !isValidObjectId(commentId)) return null;

  const order = await Order.findOne(
    mergeScopeFilter({ _id: orderId }, buildStaffOrderScopeFilter(scope)),
  )
    .select("_id")
    .lean();
  if (!order) return null;

  // Same audience rule as the read path: a comment outside the caller's vendor
  // audience must be unreachable by id, not merely unrendered.
  return OrderComment.findOne({
    _id: commentId,
    orderId: order._id,
    ...NOT_DELETED_ORDER_COMMENT_FILTER,
    ...buildCommentAudienceFilter(scope?.vendorIds),
  });
}

/**
 * PATCH /api/admin/orders/[id]/comments/[commentId]
 *
 * Edit your own comment. Deliberately author-only with NO admin override:
 * rewriting someone else's words in a shared record is falsification, not
 * moderation. An admin who disagrees with a comment deletes it (which is
 * recorded) or replies to it.
 */
export const PATCH = withApi<{ id: string; commentId: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [
      STAFF_PERMISSIONS.EDIT_ORDERS,
      STAFF_PERMISSIONS.MANAGE_ORDERS,
    ],
    rateLimit: { action: "admin:orders:comment-update", preset: "moderate" },
  },
  async ({ request, params, session, staff }) => {
    const body = await validateBody(request, OrderCommentSchema);

    const comment = await loadScopedComment(
      params.id,
      params.commentId,
      staff?.scope,
    );
    if (!comment) return notFoundResponse("Comment");

    if (String(comment.authorId) !== session.user.id) {
      throw new AuthorizationError("You can only edit your own comments");
    }

    comment.body = body.body;
    comment.editedAt = new Date();
    await comment.save();

    return successResponse({
      _id: String(comment._id),
      body: comment.body,
      editedAt: comment.editedAt,
    });
  },
);

/**
 * DELETE /api/admin/orders/[id]/comments/[commentId]
 *
 * Soft delete — the row stays, so a removed comment is still recoverable and
 * the deletion is attributable. Authors may remove their own; removing someone
 * else's is a moderation action gated on DELETE_ORDERS/MANAGE_ORDERS, the same
 * permissions that gate cancelling an order.
 *
 * Refused on demo deployments by the `withApi` default, which is intended.
 */
export const DELETE = withApi<{ id: string; commentId: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [
      STAFF_PERMISSIONS.EDIT_ORDERS,
      STAFF_PERMISSIONS.MANAGE_ORDERS,
      STAFF_PERMISSIONS.DELETE_ORDERS,
    ],
    rateLimit: { action: "admin:orders:comment-delete", preset: "moderate" },
  },
  async ({ params, session, staff }) => {
    const comment = await loadScopedComment(
      params.id,
      params.commentId,
      staff?.scope,
    );
    if (!comment) return notFoundResponse("Comment");

    const isAuthor = String(comment.authorId) === session.user.id;
    const canModerate =
      hasStaffPermission(staff?.permissions, STAFF_PERMISSIONS.DELETE_ORDERS) ||
      hasStaffPermission(staff?.permissions, STAFF_PERMISSIONS.MANAGE_ORDERS);

    if (!isAuthor && !canModerate) {
      throw new AuthorizationError(
        "You do not have permission to delete other people's comments",
      );
    }

    comment.deletedAt = new Date();
    comment.deletedBy = session.user.id as unknown as typeof comment.deletedBy;
    await comment.save();

    return successResponse({ message: "Comment deleted" });
  },
);
