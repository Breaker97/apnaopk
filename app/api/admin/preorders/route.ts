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
  hasDispatchedGoods,
  isDispatchedStatus,
} from "@/lib/orders/order-status-workflow";
import {
  getPreorderBalanceDue,
  getPreorderCollectedAmount,
} from "@/lib/orders/order-payment-status";
import { canIssueRefunds } from "@/lib/access/rbac";
import { createAuditContext } from "@/lib/audit";
import { auditPreorderMove } from "@/lib/orders/audit-preorder";
import { PREORDER_ITEM_STATUS } from "@/lib/orders/preorders";
import {
  preparePreorderCollection,
  type PreparationOutcome,
} from "@/lib/orders/preorder-collection";
import { collectionScope, isActiveCollection } from "@/lib/orders/preorder-scope";
import { cancelPreorder } from "@/lib/orders/preorder-cancellation";
import { delayPreorder } from "@/lib/orders/preorder-delay";
import {
  blockersMessage,
  describePreorderReason,
  preparationMessage,
} from "@/lib/orders/preorder-action-responses";
import { withApi } from "@/lib/api/handler";
import {
  fetchPreorderExportRows,
  fetchPreorderList,
} from "@/lib/orders/preorder-list";
import { parsePageLimit } from "@/lib/api/list-query";
import * as z from "zod";
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

    const staffFilter = buildStaffOrderScopeFilter(access.staffScope);
    const scopeQuery = mergeScopeFilter(
      {
        _id: { $in: ids },
        hasPreorder: true,
        // Cancelled pre-orders already had stock restored and quota released;
        // ready/payment_due/delay must skip them. (Re-cancel is a no-op.)
        ...(body.action !== "cancel"
          ? { status: { $ne: ORDER_STATUS.CANCELLED } }
          : {}),
      },
      staffFilter,
    );
    const orders = await Order.find(scopeQuery)
      // `getPreorderBalanceDue` and `getPreorderCollectedAmount` both read the
      // payment state, not just the figure; the notifier needs the rest.
      .select(
        "_id total status paymentStatus paymentMethod channel hasPreorder preorderOutstandingAmount preorderBalancePaidAt preorderBalancePaidAmount customerId orderNumber guestEmail preorderStatus preorderReleaseDate preorderOriginalReleaseDate preorderBalanceRequestedAt preorderCollection subOrders._id subOrders.status subOrders.paymentStatus subOrders.items.purchaseType subOrders.items.quantity subOrders.items.preorderOutstandingAmount",
      )
      .lean();
    const matchedIds = orders.map((order) => order._id);
    if (matchedIds.length === 0) {
      return successResponse({ matched: 0, modified: 0, results: [] });
    }

    // One row per order, each with its own outcome: a batch never reads as a
    // success over rows that were refused or are waiting on stock.
    const results: Array<{
      orderId: string;
      orderNumber?: string;
      outcome: string;
      message?: string;
    }> = [];
    const skipped: Array<{ orderId: string; orderNumber?: string; reason: string }> = [];
    const record = (
      order: { _id: unknown; orderNumber?: string },
      outcome: string,
      message?: string,
      refused = false,
    ) => {
      results.push({ orderId: String(order._id), orderNumber: order.orderNumber, outcome, message });
      if (refused) {
        skipped.push({
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          reason: message || outcome,
        });
      }
    };

    if (body.action === "ready" || body.action === "payment_due") {
      const prepared: typeof orders = [];
      for (const order of orders) {
        if (isDispatchedStatus(order.status)) {
          record(order, "not_eligible", "already shipped", true);
          continue;
        }
        const owed = getPreorderBalanceDue(order);
        if (body.action === "payment_due" && owed <= 0) {
          record(order, "not_eligible", "nothing is owed", true);
          continue;
        }
        // An open request is not requested twice from a bulk action.
        if (isActiveCollection(order.preorderCollection)) {
          record(order, "balance_requested", "the balance has already been requested");
          continue;
        }
        const waiting = collectionScope(order as never).map((sub: { _id?: unknown }) =>
          String(sub._id),
        );
        const outcome: PreparationOutcome = await preparePreorderCollection({
          orderId: String(order._id),
          actor: session.user.id,
          source: "admin",
          declare: waiting,
        }).catch(
          (error: unknown): PreparationOutcome => ({
            kind: "not_eligible",
            reason: error instanceof Error ? error.message : "failed",
          }),
        );
        switch (outcome.kind) {
          case "notice_pending":
          case "balance_requested":
          case "released":
          case "waiting_for_vendors":
            prepared.push(order);
            record(order, outcome.kind, preparationMessage(outcome, "admin"));
            break;
          case "waiting_for_stock":
            record(order, outcome.kind, blockersMessage(outcome.blockers), true);
            break;
          case "in_progress":
            record(order, outcome.kind, "changing right now — try again", true);
            break;
          default:
            record(order, outcome.kind, describePreorderReason(outcome.reason), true);
        }
      }
      // One row per order that moved, so each order's own Timeline says so. An
      // order whose stages did not move (waiting on another seller) leaves none:
      // both are told apart by reading the stage back.
      if (prepared.length > 0) {
        const landed = new Map(
          (
            await Order.find({ _id: { $in: prepared.map((order) => order._id) } })
              .select("status preorderStatus")
              .lean()
          ).map((now) => [String(now._id), now]),
        );
        const auditContext = createAuditContext(request, session);
        await Promise.all(
          prepared.flatMap((order) => {
            const now = landed.get(String(order._id));
            return now
              ? [
                  auditPreorderMove(auditContext, order, {
                    move:
                      now.preorderStatus === PREORDER_ITEM_STATUS.PAYMENT_DUE
                        ? "payment_due"
                        : "ready",
                    from: { status: order.status, preorderStatus: order.preorderStatus },
                    to: { status: now.status, preorderStatus: now.preorderStatus },
                    bulk: true,
                  }),
                ]
              : [];
          }),
        );
      }
      return successResponse({
        matched: matchedIds.length,
        modified: results.filter((row) =>
          ["notice_pending", "released", "waiting_for_vendors"].includes(row.outcome),
        ).length,
        results,
        ...(skipped.length > 0 ? { skipped } : {}),
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
      if (releaseDate.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
        throw new ValidationError("The new release date cannot be in the past");
      }
      let modified = 0;
      const delayAuditContext = createAuditContext(request, session);
      for (const order of orders) {
        const result = await delayPreorder({
          orderId: String(order._id),
          releaseDate,
          reason,
          actor: session.user.id,
          scopeFilter: staffFilter,
        });
        if (result.kind === "delayed") {
          modified += 1;
          record(order, result.reset ? "delayed_and_reset" : "delayed");
          await auditPreorderMove(delayAuditContext, order, {
            move: "delay",
            from: {
              preorderStatus: order.preorderStatus,
              releaseDate: result.previousReleaseDate,
            },
            to: { preorderStatus: PREORDER_ITEM_STATUS.DELAYED, releaseDate },
            reason,
            bulk: true,
          });
        } else if (result.kind === "refused") {
          record(
            order,
            "not_eligible",
            result.reason === "changed"
              ? "changed while it was being updated"
              : result.reason === "consignment_not_waiting"
                ? "already released"
                : describePreorderReason(result.reason),
            true,
          );
        } else {
          record(order, result.kind, result.kind === "in_progress" ? "changing right now" : result.reason, true);
        }
      }
      return successResponse({
        matched: matchedIds.length,
        modified,
        results,
        ...(skipped.length > 0 ? { skipped } : {}),
      });
    }

    if (body.action === "cancel") {
      // Cancelling refunds, so it is a money action as well as a status one.
      if (
        !canIssueRefunds(session.user) &&
        orders.some((order) => getPreorderCollectedAmount(order) > 0)
      ) {
        throw new AuthorizationError(
          "Only an admin can cancel a pre-order that has been paid, because the money has to be refunded",
        );
      }
      const refunds: Array<{
        orderId: string;
        orderNumber?: string;
        refunded: boolean;
        reason?: string;
        byHand?: boolean;
      }> = [];
      let modified = 0;
      const cancelAuditContext = createAuditContext(request, session);
      for (const order of orders) {
        if (hasDispatchedGoods(order)) {
          record(order, "not_eligible", "already shipped — handle it as a return", true);
          continue;
        }
        const outcome = await cancelPreorder({
          orderId: String(order._id),
          actor: session.user.id,
          actorRole: session.user.role,
          actorEmail: session.user.email || undefined,
          source: "admin",
          reason: body.reason?.trim() || "Pre-order cancelled",
          scopeFilter: staffFilter,
          audit: {
            context: cancelAuditContext,
            reason: body.reason?.trim() || undefined,
            bulk: true,
          },
        });
        if (outcome.kind !== "cancelled") {
          record(
            order,
            outcome.kind,
            outcome.kind === "refused"
              ? outcome.reason === "dispatched"
                ? "shipped while it was being cancelled"
                : describePreorderReason(outcome.reason)
              : outcome.kind === "in_progress"
                ? "changing right now — try again"
                : outcome.reason,
            true,
          );
          continue;
        }
        modified += 1;
        record(order, "cancelled");
        const refund = outcome.refund;
        if (refund) {
          refunds.push({
            orderId: String(order._id),
            orderNumber: order.orderNumber,
            refunded: refund.refunded,
            reason: refund.pending ? "the refund is still being processed" : refund.reason,
            byHand: refund.refunded && refund.gatewayCalled === false,
          });
        }
      }
      return successResponse({
        matched: matchedIds.length,
        modified,
        results,
        ...(skipped.length > 0 ? { skipped } : {}),
        refunded: refunds.filter((row) => row.refunded).length,
        // Only the ones an admin still has to deal with.
        refundsNeedingAttention: refunds.filter((row) => !row.refunded || row.byHand),
      });
    }

    throw new ValidationError("Unsupported preorder action");
  },
);
