import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { paginatedResponse, successResponse } from "@/lib/api/response";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffOrderScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import { ORDER_STATUS, USER_ROLES } from "@/config/app.config";
import {
  PREORDER_ITEM_STATUS,
  PURCHASE_TYPE,
  consumePreorderStockOnReady,
  releaseOrderPreorders,
} from "@/lib/orders/preorders";
import { reverseCouponUsageForOrder } from "@/lib/catalog/coupons";
import { restoreOrderInventory } from "@/lib/orders/order-inventory";
import { notifyPreorderCustomerUpdate } from "@/lib/notifications/notifications";
import {
  getPreorderBalanceDue,
  getPreorderCollectedAmount,
} from "@/lib/orders/order-payment-status";
import { refundCancelledPreorder } from "@/lib/orders/preorder-cancel-refund";
import { canIssueRefunds } from "@/lib/access/rbac";
import { createAuditContext } from "@/lib/audit";
import { queueAutoShipForOrder } from "@/lib/shipping/carriers/shipment-worker";
import { afterResponse } from "@/lib/after-response";
import { withApi } from "@/lib/api/handler";
import {
  fetchPreorderExportRows,
  fetchPreorderList,
} from "@/lib/orders/preorder-list";
import { parsePageLimit } from "@/lib/api/list-query";
import { z } from "zod";
import { validateOptionalBody } from "@/lib/api/validate";

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(orders: Array<Record<string, unknown>>) {
  const headers = [
    "Order",
    "Customer",
    "Email",
    "Preorder status",
    "Fulfillment status",
    "Payment status",
    "Expected release",
    "Total",
    "Created",
  ];
  const rows = orders.map((order) => {
    const customer = order.customerId as
      | { name?: string; email?: string }
      | undefined;
    return [
      order.orderNumber,
      customer?.name || "Customer",
      customer?.email || "",
      order.preorderStatus,
      order.status,
      order.paymentStatus,
      order.preorderReleaseDate
        ? new Date(String(order.preorderReleaseDate)).toISOString()
        : "",
      order.total,
      order.createdAt ? new Date(String(order.createdAt)).toISOString() : "",
    ].map(escapeCsv).join(",");
  });
  return [headers.map(escapeCsv).join(","), ...rows].join("\n");
}

const PreorderBulkActionSchema = z.object({
  action: z.enum(["ready", "payment_due", "cancel", "delay"]).optional(),
  ids: z.array(z.string().max(64)).max(500).optional(),
  releaseDate: z.string().max(40).optional(),
  reason: z.string().max(1000).optional(),
});

export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_ORDERS],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:preorders:list",
      "lenient",
      session.user.role,
    );

    await connectDB();

    const searchParams = request.nextUrl.searchParams;
    const { page, limit } = parsePageLimit(searchParams, {
      defaultLimit: 10,
      maxLimit: 100,
    });
    const search = (searchParams.get("search") || "").trim();
    const status = (searchParams.get("status") || "all").trim();
    const view = (searchParams.get("view") || "all").trim();
    const format = (searchParams.get("format") || "").trim();

    if (format === "csv") {
      const rows = await fetchPreorderExportRows(
        { search, status, view },
        { staffScope: access.staffScope },
      );
      return new NextResponse(buildCsv(rows as Array<Record<string, unknown>>), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="preorders-${new Date()
            .toISOString()
            .slice(0, 10)}.csv"`,
        },
      });
    }

    const list = await fetchPreorderList(
      { page, limit, search, status, view },
      { staffScope: access.staffScope },
    );

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);

export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:preorders:bulk",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const body = await validateOptionalBody(request, PreorderBulkActionSchema);
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id) => /^[a-fA-F0-9]{24}$/.test(id)).slice(0, 100)
      : [];
    if (!body.action || ids.length === 0) {
      throw new ValidationError("Select pre-orders and a bulk action");
    }
    if (body.action === "cancel") {
      const canCancel =
        session.user.role === USER_ROLES.ADMIN ||
        !access.staffPermissions ||
        access.staffPermissions.includes(STAFF_PERMISSIONS.DELETE_ORDERS) ||
        access.staffPermissions.includes(STAFF_PERMISSIONS.MANAGE_ORDERS);
      if (!canCancel) {
        throw new AuthorizationError("You do not have permission to cancel orders");
      }
    }

    const scopeQuery = mergeScopeFilter(
      {
        _id: { $in: ids },
        hasPreorder: true,
        // Cancelled pre-orders already had stock restored and quota released;
        // ready/payment_due/delay must skip them or they'd ship units that
        // are back in sellable stock. (Re-cancel is a harmless no-op.)
        ...(body.action !== "cancel"
          ? { status: { $ne: ORDER_STATUS.CANCELLED } }
          : {}),
      },
      buildStaffOrderScopeFilter(access.staffScope),
    );
    const orders = await Order.find(scopeQuery)
      // `getPreorderBalanceDue` and `getPreorderCollectedAmount` both read the
      // payment state, not just the figure. Projecting only the outstanding
      // amount left them defaulting to "pending, nothing paid", which sent an
      // order whose balance was already settled back round to payment_due.
      // `customerId`, `orderNumber`, `guestEmail` and the release date are
      // the notifier's own arguments — left out of the projection, every
      // bulk action mailed "#undefined" to nobody in particular.
      .select(
        "_id total status paymentStatus paymentMethod preorderOutstandingAmount preorderBalancePaidAt customerId orderNumber guestEmail preorderReleaseDate preorderBalanceRequestedAt subOrders.status subOrders.items.preorderOutstandingAmount",
      )
      .lean();
    const matchedIds = orders.map((order) => order._id);
    if (matchedIds.length === 0) {
      return successResponse({ matched: 0, modified: 0 });
    }

    if (body.action === "ready" || body.action === "payment_due") {
      const paymentDueOrders = orders.filter(
        (order) =>
          body.action === "payment_due" ||
          getPreorderBalanceDue(order) > 0,
      );
      const readyOrders = orders.filter(
        (order) =>
          body.action === "ready" &&
          getPreorderBalanceDue(order) <= 0,
      );
      const paymentDueIds = paymentDueOrders.map((order) => order._id);
      const readyIds = readyOrders.map((order) => order._id);

      // Consume the received stock BEFORE transitioning: "ready" means the
      // units physically exist, so they must be decremented and the shared
      // reservation counter freed. Orders whose stock isn't recorded yet are
      // skipped (not transitioned) and reported back to the admin.
      const stockErrors: Array<{ orderId: string; error: string }> = [];
      const transitionableReadyIds: typeof readyIds = [];
      for (const readyOrderId of readyIds) {
        const outcome = await consumePreorderStockOnReady(String(readyOrderId));
        if (outcome.consumed || outcome.alreadyConsumed) {
          transitionableReadyIds.push(readyOrderId);
        } else {
          stockErrors.push({
            orderId: String(readyOrderId),
            error: outcome.error || "Failed to allocate stock",
          });
        }
      }

      if (transitionableReadyIds.length > 0) {
        await Order.updateMany(
          {
            _id: { $in: transitionableReadyIds },
            status: { $ne: ORDER_STATUS.CANCELLED },
          },
          {
            $set: {
              status: ORDER_STATUS.PROCESSING,
              preorderStatus: PREORDER_ITEM_STATUS.READY,
              statusChangedBy: session.user.id,
              processingAt: new Date(),
              "items.$[item].preorderStatus": PREORDER_ITEM_STATUS.READY,
              // Only the consignments still waiting on the pre-order — see
              // the single-order route for what a blanket `subOrders.$[]`
              // write did to a sibling that had already shipped.
              "subOrders.$[preorderSub].status": ORDER_STATUS.PROCESSING,
              "subOrders.$[preorderSub].items.$[subItem].preorderStatus":
                PREORDER_ITEM_STATUS.READY,
            },
          },
          {
            arrayFilters: [
              { "item.purchaseType": PURCHASE_TYPE.PREORDER },
              { "preorderSub.status": ORDER_STATUS.PREORDERED },
              { "subItem.purchaseType": PURCHASE_TYPE.PREORDER },
            ],
          },
        );
      }

      if (paymentDueIds.length > 0) {
        await Order.updateMany(
          {
            _id: { $in: paymentDueIds },
            status: { $ne: ORDER_STATUS.CANCELLED },
          },
          {
            $set: {
              status: ORDER_STATUS.PREORDERED,
              preorderStatus: PREORDER_ITEM_STATUS.PAYMENT_DUE,
              statusChangedBy: session.user.id,
              "items.$[item].preorderStatus": PREORDER_ITEM_STATUS.PAYMENT_DUE,
              // As above: a shipped or cancelled sibling consignment is not
              // part of this transition.
              "subOrders.$[preorderSub].status": ORDER_STATUS.PREORDERED,
              "subOrders.$[preorderSub].items.$[subItem].preorderStatus":
                PREORDER_ITEM_STATUS.PAYMENT_DUE,
            },
          },
          {
            arrayFilters: [
              { "item.purchaseType": PURCHASE_TYPE.PREORDER },
              { "preorderSub.status": ORDER_STATUS.PREORDERED },
              { "subItem.purchaseType": PURCHASE_TYPE.PREORDER },
            ],
          },
        );

        // The expiry clock starts when the money is actually asked for, not
        // when the goods were promised — a batch that lands after its release
        // date would otherwise be past its grace period the moment the
        // request went out. Conditional so a repeat bulk action neither moves
        // a deadline nor re-sends reminders; see the order model.
        await Order.updateMany(
          {
            _id: { $in: paymentDueIds },
            preorderBalanceRequestedAt: { $exists: false },
          },
          {
            $set: { preorderBalanceRequestedAt: new Date() },
            $unset: { preorderBalanceRemindersSent: "" },
          },
        );
      }

      // Released for fulfilment — see the single-order route. Queued one order
      // at a time and after the response, so a hundred-row bulk action does
      // not hold the admin's request open while it talks to a carrier.
      for (const readyOrderId of transitionableReadyIds) {
        afterResponse(() =>
          queueAutoShipForOrder(String(readyOrderId), session.user.id),
        );
      }

      const skippedIds = new Set(stockErrors.map((entry) => entry.orderId));
      await Promise.allSettled(
        orders
          .filter((order) => !skippedIds.has(String(order._id)))
          .map((order) =>
            notifyPreorderCustomerUpdate(
              String(order.customerId),
              order.orderNumber,
              paymentDueOrders.some(
                (paymentDueOrder) =>
                  String(paymentDueOrder._id) === String(order._id),
              )
                ? "payment_due"
                : "ready",
              String(order._id),
              {
                releaseDate: order.preorderReleaseDate,
                outstandingAmount: getPreorderBalanceDue(order),
                // Freshly stamped just above for an order being asked for the
                // first time, so the deadline the shopper is given is the one
                // the expiry job will actually count from.
                balanceRequestedAt:
                  order.preorderBalanceRequestedAt || new Date(),
                // A guest order's `customerId` is its cart — see the notifier.
                guestEmail: order.guestEmail,
              },
            ),
          ),
      );
      return successResponse({
        matched: matchedIds.length,
        modified: matchedIds.length - stockErrors.length,
        ...(stockErrors.length > 0 ? { stockErrors } : {}),
      });
    }

    if (body.action === "delay") {
      const releaseDate = body.releaseDate ? new Date(body.releaseDate) : null;
      if (!releaseDate || Number.isNaN(releaseDate.getTime())) {
        throw new ValidationError("A valid release date is required");
      }
      const reason =
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim().slice(0, 500)
          : undefined;
      await Order.updateMany(
        // Not over a cancellation that landed after the read — see the
        // single-order route.
        { _id: { $in: matchedIds }, status: { $ne: ORDER_STATUS.CANCELLED } },
        {
          $set: {
            preorderStatus: PREORDER_ITEM_STATUS.DELAYED,
            preorderReleaseDate: releaseDate,
            preorderDelayReason: reason,
            preorderReleaseDateUpdatedAt: new Date(),
            preorderCustomerNotifiedAt: new Date(),
            statusChangedBy: session.user.id,
            "items.$[item].preorderReleaseDate": releaseDate,
            "items.$[item].preorderStatus": PREORDER_ITEM_STATUS.DELAYED,
            "subOrders.$[].items.$[subItem].preorderReleaseDate": releaseDate,
            "subOrders.$[].items.$[subItem].preorderStatus":
              PREORDER_ITEM_STATUS.DELAYED,
          },
          // A new date is a new promise: the reminders sent against the old one
          // must not silence the new ones. See the single-order route.
          $unset: { preorderBalanceRemindersSent: "" },
        },
        {
          arrayFilters: [
            { "item.purchaseType": PURCHASE_TYPE.PREORDER },
            { "subItem.purchaseType": PURCHASE_TYPE.PREORDER },
          ],
        },
      );
      await Promise.allSettled(
        orders.map((order) =>
          notifyPreorderCustomerUpdate(
            String(order.customerId),
            order.orderNumber,
            "delayed",
            String(order._id),
            {
              releaseDate,
              previousReleaseDate: order.preorderReleaseDate,
              reason,
              guestEmail: order.guestEmail,
            },
          ),
        ),
      );
      return successResponse({ matched: matchedIds.length, modified: matchedIds.length });
    }

    if (body.action === "cancel") {
      // Cancelling now refunds, so this is a money action as well as a status
      // one. Staff who may cancel but may not refund cannot be allowed through
      // — and cancelling while skipping the refund would be worse.
      if (
        !canIssueRefunds(session.user) &&
        orders.some((order) => getPreorderCollectedAmount(order) > 0)
      ) {
        throw new AuthorizationError(
          "Only an admin can cancel a pre-order that has been paid, because the money has to be refunded",
        );
      }

      await Order.updateMany(
        { _id: { $in: matchedIds } },
        {
          $set: {
            status: ORDER_STATUS.CANCELLED,
            preorderStatus: PREORDER_ITEM_STATUS.CANCELLED,
            cancelledAt: new Date(),
            statusChangedBy: session.user.id,
            "items.$[item].preorderStatus": PREORDER_ITEM_STATUS.CANCELLED,
            "subOrders.$[].status": ORDER_STATUS.CANCELLED,
            "subOrders.$[].items.$[subItem].preorderStatus":
              PREORDER_ITEM_STATUS.CANCELLED,
          },
        },
        {
          arrayFilters: [
            { "item.purchaseType": PURCHASE_TYPE.PREORDER },
            { "subItem.purchaseType": PURCHASE_TYPE.PREORDER },
          ],
        },
      );
      const auditContext = createAuditContext(request, session);
      const refunds: Array<{
        orderId: string;
        refunded: boolean;
        reason?: string;
        byHand?: boolean;
      }> = [];
      await Promise.allSettled(
        orders.map(async (order) => {
          // Orders already marked ready consumed physical stock — restore it
          // (claim-based per sub-order, so never-consumed orders are no-ops).
          await restoreOrderInventory(String(order._id)).catch((err) =>
            console.error(
              "Failed to restore preorder inventory on cancel:",
              err,
            ),
          );
          await releaseOrderPreorders(String(order._id));
          await reverseCouponUsageForOrder(String(order._id));

          // Cancel means refund. Never thrown: one order's gateway refusing
          // must not abandon the rest of the batch, and the cancellation
          // stands either way — so the outcome is reported back instead.
          const refund = await refundCancelledPreorder({
            orderId: String(order._id),
            reason: body.reason?.trim() || "Pre-order cancelled",
            actor: session.user.email || session.user.id,
            createdBy: session.user.id,
            auditContext,
          }).catch((err: unknown) => {
            console.error("Failed to refund cancelled pre-order:", err);
            return { refunded: false, reason: "The refund could not be issued" };
          });
          refunds.push({
            orderId: String(order._id),
            refunded: refund.refunded,
            reason: refund.reason,
            byHand:
              refund.refunded &&
              "gatewayCalled" in refund &&
              refund.gatewayCalled === false,
          });

          await notifyPreorderCustomerUpdate(
            String(order.customerId),
            order.orderNumber,
            "cancelled",
            String(order._id),
            {
              releaseDate: order.preorderReleaseDate,
              guestEmail: order.guestEmail,
            },
          );
        }),
      );
      return successResponse({
        matched: matchedIds.length,
        modified: matchedIds.length,
        refunded: refunds.filter((r) => r.refunded).length,
        // Only the ones an admin still has to deal with; an empty list means
        // every cancelled order's money is on its way back.
        // A refund no gateway carried is recorded but not yet sent, so it
        // needs a person as much as one that failed.
        refundsNeedingAttention: refunds.filter((r) => !r.refunded || r.byHand),
      });
    }

    throw new ValidationError("Unsupported preorder action");
  },
);
