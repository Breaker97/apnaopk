import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import {
  AuthorizationError,
  ConflictError,
  ServiceUnavailableError,
  ValidationError,
} from "@/lib/api/errors";
import { ORDER_STATUS, USER_ROLES } from "@/config/app.config";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { isValidObjectId, validateOptionalBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  assertAdminOrStaffPermissions,
  assertVendorStaffMayChangeOrder,
} from "@/lib/access/staff-authz";
import {
  buildStaffOrderScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import { isDispatchedStatus } from "@/lib/orders/order-status-workflow";
import { PREORDER_ITEM_STATUS } from "@/lib/orders/preorders";
import {
  manualBalanceReminderStage,
  notifyPreorderCustomerUpdate,
} from "@/lib/notifications/notifications";
import { canIssueRefunds } from "@/lib/access/rbac";
import { createAuditContext } from "@/lib/audit";
import { auditPreorderMove } from "@/lib/orders/audit-preorder";
import {
  getPreorderBalanceDue,
  getPreorderCollectedAmount,
} from "@/lib/orders/order-payment-status";
import {
  preparePreorderCollection,
  withdrawPreorderReadiness,
} from "@/lib/orders/preorder-collection";
import { collectionScope, isActiveCollection } from "@/lib/orders/preorder-scope";
import { cancelPreorder } from "@/lib/orders/preorder-cancellation";
import { delayPreorder } from "@/lib/orders/preorder-delay";
import { resendPreorderBalanceNotice } from "@/lib/orders/preorder-notice";
import { retryPreorderOperation } from "@/lib/orders/preorder-operations";
import {
  describePreorderReason,
  preparationMessage,
  throwForPreparation,
} from "@/lib/orders/preorder-action-responses";
import { PreorderOperation } from "@/models/preorder-operation.model";
import { withApi } from "@/lib/api/handler";
import * as z from "zod";

const PreorderActionSchema = z.object({
  action: z
    .enum([
      "ready",
      "payment_due",
      "cancel",
      "delay",
      "withdraw_ready",
      "resend_notice",
      "retry",
    ])
    .optional(),
  releaseDate: z.string().max(40).optional(),
  reason: z.string().max(1000).optional(),
  /** One consignment, when the action is about it alone. */
  subOrderId: z.string().max(64).optional(),
});

/**
 * One pre-order's actions, for the store.
 *
 * Every action goes through the shared pre-order services, so this route, the
 * bulk route, the vendor route and the background jobs make the same moves:
 *
 *  - `ready` / `payment_due` declare the goods available for the whole order
 *    (or the one consignment named) and prepare it: the balance is requested
 *    — with its advance notice, never an immediate charge — once every live
 *    consignment is ready and its stock allocated; with nothing owed the
 *    ready consignments are released. Asked again on an open request,
 *    `payment_due` is the "send a reminder" button.
 *  - `delay` moves the date; on a prepared order it takes the request back
 *    (stock, notice and any scheduled charge) through the shared reset.
 *  - `cancel` is the shared cancellation: status, stock, places and a
 *    durable operation for the refund and the rest.
 */
export const PUT = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:preorders:update",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Pre-order");

    const body = await validateOptionalBody(request, PreorderActionSchema);

    const staffFilter = buildStaffOrderScopeFilter(access.staffScope);
    const scopeQuery = mergeScopeFilter({ _id: id, hasPreorder: true }, staffFilter);
    const before = await Order.findOne(scopeQuery).lean();
    if (!before) return notFoundResponse("Pre-order");
    assertVendorStaffMayChangeOrder(access, before);

    // A cancelled pre-order already had its stock restored and quota released.
    if (body.action !== "cancel" && before.status === ORDER_STATUS.CANCELLED) {
      throw new ValidationError(
        "This pre-order has been cancelled and can no longer be updated",
      );
    }
    const reread = async () => (await Order.findOne(scopeQuery).lean()) ?? before;

    if (body.action === "ready" || body.action === "payment_due") {
      if (isDispatchedStatus(before.status)) {
        throw new ValidationError(
          "This pre-order has already shipped, so it is past the pre-order stage",
        );
      }
      const outstandingAmount = getPreorderBalanceDue(before);
      if (body.action === "payment_due" && outstandingAmount <= 0) {
        throw new ValidationError(
          "Nothing is owed on this pre-order — move it to fulfillment instead",
        );
      }

      // Asked again on a request that is already open: a reminder, never a
      // new request — a reminder never moves the deadline either.
      const cycle = before.preorderCollection;
      if (body.action === "payment_due" && isActiveCollection(cycle)) {
        if (cycle.state === "attention") {
          const resent = await resendPreorderBalanceNotice({ orderId: id });
          return successResponse({
            ...(await reread()),
            outcome: `notice_${resent.state}`,
            outcomeMessage:
              resent.state === "accepted"
                ? "The balance notice was sent again and accepted."
                : resent.state === "attention"
                  ? "The balance notice could not be delivered again — check the customer's contact details."
                  : "The balance notice is being sent again.",
          });
        }
        if (cycle.state === "awaiting_payment") {
          await notifyPreorderCustomerUpdate(
            String(before.customerId),
            before.orderNumber,
            "payment_due",
            String(before._id),
            {
              releaseDate: before.preorderReleaseDate,
              outstandingAmount,
              balanceRequestedAt: before.preorderBalanceRequestedAt,
              preorderCollection: cycle,
              reminderStage: manualBalanceReminderStage(),
              guestEmail: before.guestEmail,
            },
          ).catch((err) => console.error("Failed to send a balance reminder:", err));
          return successResponse({
            ...before,
            outcome: "reminder_sent",
            outcomeMessage: "Balance reminder sent.",
          });
        }
        return successResponse({
          ...before,
          outcome: "notice_pending",
          outcomeMessage: "The balance notice is still being delivered.",
        });
      }

      // The store speaks for the whole order — or for the one consignment it
      // names — and says so explicitly.
      const waiting = collectionScope(before as never).map((sub: { _id?: unknown }) =>
        String(sub._id),
      );
      const declare = body.subOrderId ? [body.subOrderId] : waiting;
      if (body.subOrderId && !waiting.includes(body.subOrderId)) {
        throw new ValidationError("That consignment is not waiting on its pre-order goods");
      }
      const outcome = await preparePreorderCollection({
        orderId: id,
        actor: session.user.id,
        source: "admin",
        declare,
        releaseScope: body.subOrderId ? [body.subOrderId] : undefined,
      });
      throwForPreparation(outcome);
      const after = await reread();
      // Recorded once the write has landed. A consignment declared while others
      // are still waiting moved no stage and leaves no row.
      await auditPreorderMove(createAuditContext(request, session), after, {
        move:
          after.preorderStatus === PREORDER_ITEM_STATUS.PAYMENT_DUE ? "payment_due" : "ready",
        from: { status: before.status, preorderStatus: before.preorderStatus },
        to: { status: after.status, preorderStatus: after.preorderStatus },
      });
      return successResponse({
        ...after,
        outcome: outcome.kind,
        outcomeMessage: preparationMessage(outcome, "admin"),
      });
    }

    if (body.action === "withdraw_ready") {
      if (!body.subOrderId) throw new ValidationError("Name the consignment to withdraw");
      const result = await withdrawPreorderReadiness({
        orderId: id,
        subOrderIds: [body.subOrderId],
      });
      if (result.refused) throw new ValidationError(describePreorderReason(result.refused));
      return successResponse({ ...(await reread()), outcome: "withdrawn" });
    }

    if (body.action === "resend_notice") {
      const resent = await resendPreorderBalanceNotice({ orderId: id });
      if (resent.state === "skipped") {
        throw new ValidationError("There is no balance notice to send for this pre-order");
      }
      return successResponse({ ...(await reread()), outcome: `notice_${resent.state}` });
    }

    if (body.action === "retry") {
      // Whatever stopped for a person on this order: a release waiting on
      // stock, a cancellation's refund, a notice.
      const operations = await PreorderOperation.find({
        orderId: before._id,
        state: { $in: ["attention", "waiting", "pending"] },
      })
        .select("_id")
        .lean<Array<{ _id: unknown }>>();
      const outcomes = [];
      for (const operation of operations) {
        outcomes.push(await retryPreorderOperation(String(operation._id)));
      }
      return successResponse({ ...(await reread()), outcome: "retried", retried: outcomes });
    }

    if (body.action === "delay") {
      const releaseDate = body.releaseDate ? new Date(body.releaseDate) : null;
      if (!releaseDate || Number.isNaN(releaseDate.getTime())) {
        throw new ValidationError("A valid release date is required");
      }
      // A day of slack for a date input's midnight UTC, as the vendor route
      // allows — but a date already gone is no new promise to give anyone.
      if (releaseDate.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
        throw new ValidationError("The new release date cannot be in the past");
      }
      const reason =
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim().slice(0, 500)
          : undefined;
      const result = await delayPreorder({
        orderId: id,
        releaseDate,
        reason,
        actor: session.user.id,
        scopeFilter: staffFilter,
      });
      if (result.kind === "refused") {
        throw new ValidationError(
          result.reason === "changed"
            ? "This pre-order was cancelled or released while you were updating it — reload it before moving its date"
            : describePreorderReason(result.reason),
        );
      }
      if (result.kind === "unavailable") throw new ServiceUnavailableError(result.reason);
      if (result.kind === "in_progress") {
        throw new ConflictError("Another change to this pre-order is in progress — try again in a moment.");
      }
      const after = await reread();
      await auditPreorderMove(createAuditContext(request, session), after, {
        move: "delay",
        from: {
          preorderStatus: before.preorderStatus,
          releaseDate: result.previousReleaseDate,
        },
        to: { preorderStatus: after.preorderStatus, releaseDate },
        reason,
      });
      return successResponse({
        ...after,
        outcome: result.reset ? "delayed_and_reset" : "delayed",
      });
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
      // Cancelling sends the shopper's money back, so it is a refund as well
      // as a status change — the same authority a refund needs.
      if (getPreorderCollectedAmount(before) > 0 && !canIssueRefunds(session.user)) {
        throw new AuthorizationError(
          "Only an admin can cancel a pre-order that has been paid, because the money has to be refunded",
        );
      }
      const outcome = await cancelPreorder({
        orderId: id,
        actor: session.user.id,
        actorRole: session.user.role,
        actorEmail: session.user.email || undefined,
        source: "admin",
        reason: body.reason?.trim() || "Pre-order cancelled",
        scopeFilter: staffFilter,
        audit: {
          context: createAuditContext(request, session),
          reason: body.reason?.trim() || undefined,
        },
      });
      if (outcome.kind === "refused") {
        throw new ValidationError(
          outcome.reason === "dispatched"
            ? "Part of this order has already shipped, so it can no longer be cancelled here — cancel the remaining consignments from the order page, or handle it as a return"
            : describePreorderReason(outcome.reason),
        );
      }
      if (outcome.kind === "unavailable") throw new ServiceUnavailableError(outcome.reason);
      if (outcome.kind === "in_progress") {
        throw new ConflictError("This pre-order is changing right now — try again in a moment.");
      }
      return successResponse({
        ...(await reread()),
        refund: outcome.refund ?? {
          refunded: false,
          reason: "Nothing was collected on this order",
        },
      });
    }

    throw new ValidationError("Unsupported preorder action");
  },
);
