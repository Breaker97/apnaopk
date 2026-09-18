import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { canIssueRefunds } from "@/lib/access/rbac";
import { buildStaffOrderScopeFilter, mergeScopeFilter } from "@/lib/access/staff-scope";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { reattributeChargeback } from "@/lib/orders/order-refund-sync";

const AttributeChargebackSchema = z.object({
  subOrderIds: z
    .array(z.string().refine(isValidObjectId, "Not a consignment"))
    .min(1, "Choose the seller this chargeback belongs to")
    .max(50),
});

/**
 * POST /api/admin/orders/[id]/chargebacks/[transactionId]/attribute
 *
 * Put a chargeback on the sellers it belongs to — see `reattributeChargeback`.
 * It moves money between sellers' payouts, so it needs the same refund
 * authority recording the chargeback did.
 */
export const POST = withApi<{ id: string; transactionId: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.MANAGE_ORDERS],
    );
    if (!canIssueRefunds(session.user)) {
      throw new AuthorizationError(
        "Only someone who can issue refunds can move a chargeback between sellers",
      );
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:orders:chargeback-attribute",
      "moderate",
      session.user.role,
    );

    const { id, transactionId } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Order");
    if (!isValidObjectId(transactionId)) return notFoundResponse("Chargeback");

    const body = await validateBody(request, AttributeChargebackSchema);

    await connectDB();
    // A scoped staff member reaches only the orders their scope allows.
    const visible = await Order.exists(
      mergeScopeFilter({ _id: id }, buildStaffOrderScopeFilter(access.staffScope)),
    );
    if (!visible) throw new NotFoundError("Order");

    const result = await reattributeChargeback({
      orderId: id,
      transactionId,
      subOrderIds: body.subOrderIds,
      actorId: session.user.id,
      actorLabel: session.user.email || session.user.id,
    });

    return successResponse(result);
  },
);
