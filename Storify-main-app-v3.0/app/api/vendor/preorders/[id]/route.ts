import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { toVendorOrderView } from "@/lib/vendors/vendor-order-view";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "@/lib/api/errors";
import { ORDER_STATUS } from "@/config/app.config";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { isValidObjectId, validateOptionalBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  manualBalanceReminderStage,
  notifyPreorderCustomerUpdate,
} from "@/lib/notifications/notifications";
import { getPreorderBalanceDue } from "@/lib/orders/order-payment-status";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import {
  preparePreorderCollection,
  reconcilePreorderCollection,
  withdrawPreorderReadiness,
} from "@/lib/orders/preorder-collection";
import {
  collectionScope,
  isActiveCollection,
  readinessSummary,
} from "@/lib/orders/preorder-scope";
import { cancelPreorder } from "@/lib/orders/preorder-cancellation";
import { delayPreorder } from "@/lib/orders/preorder-delay";
import { retryPreorderOperation } from "@/lib/orders/preorder-operations";
import {
  describePreorderReason,
  preparationMessage,
  throwForPreparation,
} from "@/lib/orders/preorder-action-responses";
import { PreorderOperation } from "@/models/preorder-operation.model";
import { PREORDER_ITEM_STATUS } from "@/lib/orders/preorders";
import { createAuditContext } from "@/lib/audit";
import { auditPreorderMove } from "@/lib/orders/audit-preorder";
import { withApi } from "@/lib/api/handler";
import * as z from "zod";

const VendorPreorderActionSchema = z.object({
  /**
   * `ready` is "Mark goods available" for this vendor's own consignment.
   * `payment_due` is what the shared table sends for "Send balance reminder";
   * with no request open it means the same as `ready` — a seller's goods
   * being in is all a seller can say about the balance.
   */
  action: z
    .enum(["ready", "payment_due", "cancel", "delay", "withdraw_ready", "retry"])
    .optional(),
  /** `delay`: the new expected ship date for this vendor's lines. */
  releaseDate: z.string().max(40).optional(),
  /** `delay`: why, in words the shopper will read. Required for a vendor. */
  reason: z.string().max(1000).optional(),
});

/**
 * A seller's actions on their own pre-order consignment.
 *
 * A seller speaks only for their own goods. "Mark goods available" records
 * that, and nothing else moves until every live consignment on the order is
 * available: then the order's one balance is requested (with its advance
 * notice — never a charge on the spot) or, with nothing owed, this seller's
 * consignment is released. The answer says how many other consignments the
 * order is waiting for, never whose, what they hold or what they cost.
 */
export const PUT = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const user = session.user;
    const canEdit = await hasVendorPermission(user, VENDOR_PERMISSIONS.EDIT_ORDERS);
    const canManage = canEdit
      ? true
      : await hasVendorPermission(user, VENDOR_PERMISSIONS.MANAGE_ORDERS);
    if (!canEdit && !canManage && !isAdmin(user)) {
      throw new AuthorizationError("You do not have permission to edit orders");
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:preorders:update",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    const vendor = await requireApprovedVendorByUserId(session.user.id);
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Pre-order");

    const body = await validateOptionalBody(request, VendorPreorderActionSchema);

    const orderFilter = { _id: id, hasPreorder: true, "subOrders.vendorId": vendor._id };
    const order = await Order.findOne(orderFilter).lean();
    if (!order) return notFoundResponse("Pre-order");
    const vendorKey = vendor._id.toString();
    const subOrder = (order.subOrders || []).find(
      (sub: { vendorId?: { toString: () => string } }) => sub.vendorId?.toString() === vendorKey,
    );
    if (!subOrder) return notFoundResponse("Pre-order");
    const ownSubId = String(subOrder._id);
    const reread = async () => (await Order.findOne(orderFilter).lean()) ?? order;
    const view = async (extra: Record<string, unknown> = {}, current?: typeof order) => {
      const fresh = current ?? (await reread());
      const summary = readinessSummary(fresh as never, vendorKey);
      return {
        ...toVendorOrderView(fresh, vendor._id),
        readiness: {
          ownReady: summary.ownReady,
          othersWaiting: summary.othersWaiting,
        },
        ...extra,
      };
    };

    // Where this consignment stood before the action: the Activity Log rows
    // compare the order read back afterwards to this.
    const consignmentBefore = subOrder.status;
    const consignmentAfter = (fresh: typeof order) =>
      (fresh.subOrders || []).find(
        (sub: { _id?: unknown }) => String(sub._id) === ownSubId,
      )?.status;
    const auditContext = createAuditContext(request, session, {
      vendorId: vendor._id,
    });

    if (body.action === "ready" || body.action === "payment_due") {
      if (
        order.status === ORDER_STATUS.CANCELLED ||
        subOrder.status === ORDER_STATUS.CANCELLED
      ) {
        throw new ValidationError(
          "This pre-order has been cancelled and can no longer be marked ready",
        );
      }
      if (
        subOrder.status === ORDER_STATUS.SHIPPED ||
        subOrder.status === ORDER_STATUS.DELIVERED
      ) {
        throw new ValidationError(
          "This consignment has already shipped, so it is past the pre-order stage",
        );
      }

      // "Send balance reminder" on a request that is open and delivered.
      const cycle = order.preorderCollection;
      if (
        body.action === "payment_due" &&
        isActiveCollection(cycle) &&
        cycle.state === "awaiting_payment"
      ) {
        await notifyPreorderCustomerUpdate(
          String(order.customerId),
          order.orderNumber,
          "payment_due",
          String(order._id),
          {
            releaseDate: order.preorderReleaseDate,
            outstandingAmount: getPreorderBalanceDue(order),
            balanceRequestedAt: order.preorderBalanceRequestedAt,
            preorderCollection: cycle,
            reminderStage: manualBalanceReminderStage(),
            // A guest order's `customerId` is its cart — see the notifier.
            guestEmail: order.guestEmail,
          },
        ).catch((err) =>
          console.error("Failed to notify preorder balance customer:", err),
        );
        return successResponse(await view({ outcome: "reminder_sent" }));
      }

      const waiting = collectionScope(order as never).some(
        (sub: { _id?: unknown }) => String(sub._id) === ownSubId,
      );
      if (!waiting) {
        throw new ValidationError("This consignment has already been released");
      }
      const outcome = await preparePreorderCollection({
        orderId: String(order._id),
        actor: session.user.id,
        source: "vendor",
        declare: [ownSubId],
        // With nothing owed, a seller releases their own goods only.
        releaseScope: [ownSubId],
      });
      throwForPreparation(outcome, { vendorSubOrderIds: [ownSubId] });
      const fresh = await reread();
      // Recorded as the database ended up. Goods declared while another seller
      // is still waiting moved no stage and leave no row.
      const requested = fresh.preorderStatus === PREORDER_ITEM_STATUS.PAYMENT_DUE;
      await auditPreorderMove(auditContext, fresh, {
        move: requested ? "payment_due" : "ready",
        // The balance is the whole order's; a release is this seller's own.
        ...(requested ? {} : { consignmentOf: vendor.storeName }),
        from: {
          status: order.status,
          preorderStatus: order.preorderStatus,
          consignmentStatus: consignmentBefore,
        },
        to: {
          status: fresh.status,
          preorderStatus: fresh.preorderStatus,
          consignmentStatus: consignmentAfter(fresh),
        },
      });
      return successResponse(
        await view(
          {
            outcome: outcome.kind,
            outcomeMessage: preparationMessage(outcome, "vendor"),
          },
          fresh,
        ),
      );
    }

    if (body.action === "withdraw_ready") {
      const result = await withdrawPreorderReadiness({
        orderId: String(order._id),
        subOrderIds: [ownSubId],
      });
      if (result.refused) throw new ValidationError(describePreorderReason(result.refused));
      return successResponse(await view({ outcome: "withdrawn" }));
    }

    if (body.action === "retry") {
      // A paid release waiting on this seller's stock — the shared, guarded
      // release; it moves nothing a sibling has not made ready.
      const operations = await PreorderOperation.find({
        orderId: order._id,
        kind: "release",
        subOrderIds: subOrder._id,
        state: { $in: ["waiting", "attention", "pending"] },
      })
        .select("_id")
        .lean<Array<{ _id: unknown }>>();
      for (const operation of operations) {
        await retryPreorderOperation(String(operation._id));
      }
      return successResponse(await view({ outcome: "retried" }));
    }

    if (body.action === "delay") {
      if (
        order.status === ORDER_STATUS.CANCELLED ||
        subOrder.status === ORDER_STATUS.CANCELLED
      ) {
        throw new ValidationError(
          "This pre-order has been cancelled and can no longer be updated",
        );
      }
      if (subOrder.status !== ORDER_STATUS.PREORDERED) {
        throw new ValidationError(
          "This consignment has already been released, so its date can no longer change",
        );
      }
      const releaseDate = body.releaseDate ? new Date(body.releaseDate) : null;
      if (!releaseDate || Number.isNaN(releaseDate.getTime())) {
        throw new ValidationError("A valid release date is required");
      }
      // A day of slack for a date input's midnight UTC.
      const DAY_MS = 24 * 60 * 60 * 1000;
      if (releaseDate.getTime() < Date.now() - DAY_MS) {
        throw new ValidationError("The new release date cannot be in the past");
      }
      // The same ceiling a vendor meets when they first set the date.
      const { maxLeadDays } = resolvePreorderPolicy(settings.preorder);
      if (releaseDate.getTime() > Date.now() + maxLeadDays * DAY_MS) {
        throw new ValidationError(
          `The release date can be at most ${maxLeadDays} days from today`,
        );
      }
      // Required of a vendor: the shopper is being asked whether to wait.
      const reason =
        typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
      if (!reason) {
        throw new ValidationError("Tell the customer why the date is changing");
      }
      const result = await delayPreorder({
        orderId: String(order._id),
        releaseDate,
        reason,
        actor: session.user.id,
        vendorId: vendorKey,
      });
      if (result.kind === "refused") {
        throw new ValidationError(
          result.reason === "changed"
            ? "This order changed while you were updating it. Refresh the page and try again."
            : describePreorderReason(result.reason),
        );
      }
      if (result.kind === "unavailable") throw new ServiceUnavailableError(result.reason);
      if (result.kind === "in_progress") {
        throw new ConflictError("Another change to this pre-order is in progress — try again in a moment.");
      }
      const fresh = await reread();
      await auditPreorderMove(auditContext, fresh, {
        move: "delay",
        consignmentOf: vendor.storeName,
        // This seller's own dates: the order's is its latest line, which on a
        // split order may not have moved.
        from: {
          preorderStatus: order.preorderStatus,
          releaseDate: result.previousReleaseDate,
        },
        to: { preorderStatus: fresh.preorderStatus, releaseDate },
        reason,
      });
      return successResponse(await view({ outcome: "delayed" }, fresh));
    }

    if (body.action === "cancel") {
      const canDelete = await hasVendorPermission(user, VENDOR_PERMISSIONS.DELETE_ORDERS);
      if (!canDelete && !canManage && !isAdmin(user)) {
        throw new AuthorizationError("You do not have permission to cancel orders");
      }
      if (subOrder.status === ORDER_STATUS.CANCELLED) {
        throw new ValidationError("This consignment has already been cancelled");
      }
      if (
        subOrder.status === ORDER_STATUS.SHIPPED ||
        subOrder.status === ORDER_STATUS.DELIVERED
      ) {
        throw new ValidationError(
          "This consignment has already shipped, so it can no longer be cancelled — handle it as a return instead",
        );
      }
      const outcome = await cancelPreorder({
        orderId: String(order._id),
        subOrderIds: [ownSubId],
        actor: session.user.id,
        actorRole: session.user.role,
        actorEmail: session.user.email || undefined,
        source: "vendor",
        reason:
          (order.subOrders || []).filter(
            (sub: { status?: string }) => sub.status !== ORDER_STATUS.CANCELLED,
          ).length > 1
            ? "Pre-order consignment cancelled by the seller"
            : "Pre-order cancelled by the seller",
        audit: { context: auditContext, consignmentOf: vendor.storeName },
      });
      if (outcome.kind === "refused") {
        throw new ValidationError(
          outcome.reason === "already_cancelled"
            ? "This consignment has already been cancelled"
            : describePreorderReason(outcome.reason),
        );
      }
      if (outcome.kind === "unavailable") throw new ServiceUnavailableError(outcome.reason);
      if (outcome.kind === "in_progress") {
        throw new ConflictError(
          "This consignment changed while it was being cancelled — reload it and try again",
        );
      }
      // The rest of the order may now be ready on its own — or a request for
      // a scope that no longer exists has to be replaced.
      if (!outcome.wholeOrder) {
        await reconcilePreorderCollection({ orderId: String(order._id) }).catch((error) =>
          console.error("Failed to reconcile a pre-order after a consignment cancel:", error),
        );
      }
      return successResponse(
        await view({
          // Nothing collected comes back as no outcome at all; the table still
          // wants a reason, rather than announcing a refund that never happened.
          refund: outcome.refund ?? {
            refunded: false,
            reason: "Nothing was collected for this consignment, so nothing was refunded",
          },
        }),
      );
    }

    throw new ValidationError("Unsupported preorder action");
  },
);
