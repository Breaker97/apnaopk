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
import { getPreorderBalanceDue } from "@/lib/orders/order-payment-status";
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
      .select("_id preorderOutstandingAmount")
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
              "subOrders.$[].status": ORDER_STATUS.PROCESSING,
              "subOrders.$[].items.$[subItem].preorderStatus":
                PREORDER_ITEM_STATUS.READY,
            },
          },
          {
            arrayFilters: [
              { "item.purchaseType": PURCHASE_TYPE.PREORDER },
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
              "subOrders.$[].status": ORDER_STATUS.PREORDERED,
              "subOrders.$[].items.$[subItem].preorderStatus":
                PREORDER_ITEM_STATUS.PAYMENT_DUE,
            },
          },
          {
            arrayFilters: [
              { "item.purchaseType": PURCHASE_TYPE.PREORDER },
              { "subItem.purchaseType": PURCHASE_TYPE.PREORDER },
            ],
          },
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
        { _id: { $in: matchedIds } },
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
            },
          ),
        ),
      );
      return successResponse({ matched: matchedIds.length, modified: matchedIds.length });
    }

    if (body.action === "cancel") {
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
          await notifyPreorderCustomerUpdate(
            String(order.customerId),
            order.orderNumber,
            "cancelled",
            String(order._id),
            { releaseDate: order.preorderReleaseDate },
          );
        }),
      );
      return successResponse({ matched: matchedIds.length, modified: matchedIds.length });
    }

    throw new ValidationError("Unsupported preorder action");
  },
);
