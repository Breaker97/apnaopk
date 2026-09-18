import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { AuthorizationError } from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { USER_ROLES } from "@/config/app.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { canIssueRefunds } from "@/lib/access/rbac";
import { buildStaffOrderScopeFilter } from "@/lib/access/staff-scope";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { createAuditContext } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { cancelConsignment } from "@/lib/orders/consignment-cancel";

const CancelConsignmentSchema = z.object({
  reason: z.string().trim().min(3, "Say why the consignment is cancelled").max(500),
  override: z.boolean().optional(),
});

/**
 * POST /api/admin/orders/[id]/consignments/[subOrderId]/cancel
 *
 * Cancel one seller's consignment on a split order — see `cancelConsignment`.
 * Cancelling needs the same permission as cancelling an order, and because the
 * consignment's share is refunded, the same refund authority an admin needs to
 * cancel a paid order. Cancelling a consignment that has already shipped is an
 * override, which only an admin may make.
 */
export const POST = withApi<{ id: string; subOrderId: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.DELETE_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
    );
    if (!canIssueRefunds(session.user)) {
      throw new AuthorizationError(
        "Only an admin can cancel a consignment, because its share of the payment has to be refunded",
      );
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:orders:consignment-cancel",
      "moderate",
      session.user.role,
    );

    const { id, subOrderId } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Order");
    if (!isValidObjectId(subOrderId)) return notFoundResponse("Consignment");

    const body = await validateBody(request, CancelConsignmentSchema);
    if (body.override && session.user.role !== USER_ROLES.ADMIN) {
      throw new AuthorizationError("Only admins can override the order workflow");
    }

    await connectDB();
    const result = await cancelConsignment({
      orderId: id,
      subOrderId,
      reason: body.reason,
      override: body.override === true,
      actorUserId: session.user.id,
      actorLabel: session.user.email || session.user.id,
      auditContext: createAuditContext(request, session),
      scopeFilter: buildStaffOrderScopeFilter(access.staffScope),
    });

    return successResponse(result);
  },
);
