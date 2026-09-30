import "server-only";

import { withApi } from "@/lib/api/handler";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { createdResponse, notFoundResponse, successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import {
  StaffCreateReturnRequestSchema,
  StaffPreviewReturnRequestSchema,
} from "@/lib/validations";
import {
  createReturnRequests,
  previewReturn,
  returnDialogContext,
} from "@/lib/returns/create-return";
import {
  loadOrderForReturnRoute,
  type ReturnRouteScope,
} from "@/lib/returns/return-route-access";
import { createAuditContext } from "@/lib/audit";
import { auditOrderReturn } from "@/lib/orders/audit-order";

/**
 * The routes a store or a seller opens a return through, built once for each
 * of them: the store's under /api/admin/returns, a seller's under
 * /api/vendor/returns, where the only differences are whose orders are seen,
 * whose lines may come back, and who may open one past the window.
 */

type OrderForReturn = Parameters<typeof createReturnRequests>[0]["order"];

/** GET ?orderId= (what may come back) and POST (a priced preview). */
export function openReturnDialogHandlers(scope: ReturnRouteScope) {
  const GET = withApi(
    {
      auth: "user",
      rateLimit: { action: `${scope}:returns:open:read`, preset: "lenient" },
    },
    async ({ request, session }) => {
      await connectDB();
      const orderId = request.nextUrl.searchParams.get("orderId") || "";
      const loaded = await loadOrderForReturnRoute({
        scope,
        user: session.user,
        orderId,
        mode: "read",
      });
      if (!loaded) return notFoundResponse("Order");
      const context = await returnDialogContext(
        loaded.order as OrderForReturn,
        await getSettings(),
        { onlyVendorId: loaded.onlyVendorId },
      );
      return successResponse({ ...context, canOverride: loaded.canOverride });
    },
  );

  const POST = withApi(
    {
      auth: "user",
      rateLimit: { action: `${scope}:returns:open:preview`, preset: "moderate" },
    },
    async ({ request, session }) => {
      const body = await validateBody(request, StaffPreviewReturnRequestSchema);
      await connectDB();
      const loaded = await loadOrderForReturnRoute({
        scope,
        user: session.user,
        orderId: body.orderId,
        mode: "write",
      });
      if (!loaded) return notFoundResponse("Order");
      if (body.override && !loaded.canOverride) {
        throw new AuthorizationError(
          "Only the store can open a return past the return window or on a final-sale item",
        );
      }
      const preview = await previewReturn({
        order: loaded.order as OrderForReturn,
        items: body.items,
        reason: body.reason,
        settings: await getSettings(),
        onlyVendorId: loaded.onlyVendorId,
        override: Boolean(body.override && loaded.canOverride),
      });
      return successResponse(preview);
    },
  );

  return { GET, POST };
}

/** POST: open the return, approved, with how the parcel comes back. */
export function createReturnHandler(scope: ReturnRouteScope) {
  return withApi(
    {
      auth: "user",
      rateLimit: { action: `${scope}:returns:create`, preset: "moderate" },
    },
    async ({ request, session }) => {
      const body = await validateBody(request, StaffCreateReturnRequestSchema);
      await connectDB();
      const loaded = await loadOrderForReturnRoute({
        scope,
        user: session.user,
        orderId: body.orderId,
        mode: "write",
      });
      if (!loaded) return notFoundResponse("Order");
      if (body.eligibilityOverride && !loaded.canOverride) {
        throw new AuthorizationError(
          "Only an admin, or staff allowed to, can open a return past the return window or on a final-sale item",
        );
      }
      if (body.returnMethod === "label" && !body.labelUrl) {
        throw new ValidationError(
          "Give the label's link, or open the return and add the label file to it afterwards.",
        );
      }

      const order = loaded.order as OrderForReturn;
      const created = await createReturnRequests({
        order,
        items: body.items,
        reason: body.reason,
        customerNote: body.customerNote,
        refundDestination: body.refundDestination,
        settings: await getSettings(),
        userId: session.user.id,
        openedBy: scope === "admin" ? "staff" : "vendor",
        approval: { method: body.returnMethod, labelUrl: body.labelUrl },
        onlyVendorId: loaded.onlyVendorId,
        eligibilityOverride: body.eligibilityOverride,
      });

      // On the order's timeline, with why when it was past the window.
      const auditContext = createAuditContext(request, session);
      for (const returnRequest of created) {
        await auditOrderReturn(
          auditContext,
          { _id: order._id, orderNumber: order.orderNumber },
          {
            returnNumber: String(returnRequest.returnNumber || ""),
            to: String(returnRequest.status),
            reason: body.eligibilityOverride
              ? `opened for the shopper outside the return rules: ${body.eligibilityOverride.note}`
              : "opened for the shopper",
          },
        ).catch((error: unknown) =>
          console.error("Failed to audit an opened return:", error),
        );
      }

      return createdResponse(
        created.length === 1 ? created[0] : created,
        "Return opened",
      );
    },
  );
}
