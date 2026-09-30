import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
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
import {
  PREORDER_ITEM_STATUS,
  PURCHASE_TYPE,
  consumePreorderStockOnReady,
  releaseOrderPreorders,
} from "@/lib/orders/preorders";
import { restoreOrderInventory } from "@/lib/orders/order-inventory";
import { getFulfillmentPaymentBlock } from "@/lib/orders/fulfillment-payment-gate";
import {
  DISPATCHED_ORDER_STATUSES,
  hasDispatchedGoods,
  isDispatchedStatus,
} from "@/lib/orders/order-status-workflow";
import { voidLabelsForCancellation } from "@/lib/shipping/cancel-labels";
import { reverseCouponUsageForOrder } from "@/lib/catalog/coupons";
import {
  manualBalanceReminderStage,
  notifyPreorderCustomerUpdate,
} from "@/lib/notifications/notifications";
import { refundCancelledPreorder } from "@/lib/orders/preorder-cancel-refund";
import { canIssueRefunds } from "@/lib/access/rbac";
import { createAuditContext } from "@/lib/audit";
import {
  getPreorderBalanceDue,
  getPreorderCollectedAmount,
} from "@/lib/orders/order-payment-status";
import { collectPreorderBalanceOnRequest } from "@/lib/payments/preorder-balance-charge";
import { queueAutoShipForOrder } from "@/lib/shipping/carriers/shipment-worker";
import { afterResponse } from "@/lib/after-response";
import { withApi } from "@/lib/api/handler";
import * as z from "zod";

const PreorderActionSchema = z.object({
  action: z.enum(["ready", "payment_due", "cancel", "delay"]).optional(),
  releaseDate: z.string().max(40).optional(),
  reason: z.string().max(1000).optional(),
});

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

    const scopeQuery = mergeScopeFilter(
      { _id: id, hasPreorder: true },
      buildStaffOrderScopeFilter(access.staffScope),
    );
    const before = await Order.findOne(scopeQuery).lean();
    if (!before) return notFoundResponse("Pre-order");
    assertVendorStaffMayChangeOrder(access, before);

    // A cancelled pre-order already had its stock restored and quota released
    // — flipping it to ready/processing would ship units that are back in
    // sellable stock (and a later cancel would restore nothing, the claim
    // flags are spent).
    if (
      body.action !== "cancel" &&
      before.status === ORDER_STATUS.CANCELLED
    ) {
      throw new ValidationError(
        "This pre-order has been cancelled and can no longer be updated",
      );
    }

    if (body.action === "ready" || body.action === "payment_due") {
      // Past the pre-order already. Both actions write the order-level status,
      // so either one dragged a shipped or delivered order back to processing
      // (or to "pay now") — the same refusal the vendor route makes.
      if (isDispatchedStatus(before.status)) {
        throw new ValidationError(
          "This pre-order has already shipped, so it is past the pre-order stage",
        );
      }
      // Zero once the balance has been recorded as paid — the raw figure
      // stays on the order for good and would re-request money already in.
      const outstandingAmount = getPreorderBalanceDue(before);
      if (body.action === "payment_due" && outstandingAmount <= 0) {
        throw new ValidationError(
          "Nothing is owed on this pre-order — move it to fulfillment instead",
        );
      }
      const shouldRequestPayment =
        body.action === "payment_due" || outstandingAmount > 0;
      // Nothing is owed by the balance rule, but that rule also reads a
      // deposit or full payment that never captured as "nothing owed" — and
      // releasing it consumed stock and packed goods nobody paid for. The
      // vendor route and the orders screen already asked this.
      if (!shouldRequestPayment) {
        const paymentBlock = getFulfillmentPaymentBlock(before, null);
        if (paymentBlock) throw new ValidationError(paymentBlock);
      }
      const nextOrderStatus = shouldRequestPayment
        ? ORDER_STATUS.PREORDERED
        : ORDER_STATUS.PROCESSING;
      const nextPreorderStatus = shouldRequestPayment
        ? PREORDER_ITEM_STATUS.PAYMENT_DUE
        : PREORDER_ITEM_STATUS.READY;

      // "Ready" means the received units physically exist: consume them and
      // free the shared reservation counter BEFORE transitioning (mirrors the
      // bulk endpoint — without this, the received stock stayed sellable
      // online while also being committed to this pre-order). Insufficient
      // stock aborts the transition so the admin can restock first.
      if (!shouldRequestPayment) {
        const outcome = await consumePreorderStockOnReady(id);
        if (!outcome.consumed && !outcome.alreadyConsumed) {
          throw new ValidationError(
            outcome.error || "Failed to allocate stock for this pre-order",
          );
        }
      }

      // Asked for the first time, or asked again? Only the first request
      // starts the expiry clock — see `preorderBalanceRequestedAt` on the
      // model. A repeat click must not push the deadline out, and must not
      // re-send reminders the shopper has already had.
      const startsTheBalanceClock =
        shouldRequestPayment && !before.preorderBalanceRequestedAt;

      const order = await Order.findOneAndUpdate(
        // Status guard closes the race with a concurrent cancel — without it
        // this update would resurrect a just-cancelled order — and with a
        // shipment landing after the read.
        {
          ...scopeQuery,
          status: {
            $nin: [ORDER_STATUS.CANCELLED, ...DISPATCHED_ORDER_STATUSES],
          },
        },
        {
          $set: {
            status: nextOrderStatus,
            preorderStatus: nextPreorderStatus,
            statusChangedBy: session.user.id,
            ...(shouldRequestPayment ? {} : { processingAt: new Date() }),
            ...(startsTheBalanceClock
              ? { preorderBalanceRequestedAt: new Date() }
              : {}),
            "items.$[item].preorderStatus": nextPreorderStatus,
            // ONLY the consignments still waiting on the pre-order. An order
            // can pair a pre-order from one seller with stock lines from
            // another that have already shipped (or been cancelled), and a
            // blanket `subOrders.$[]` write dragged those back to processing
            // — telling the shopper goods they are holding are being packed,
            // and resurrecting a cancelled consignment into a payable one.
            // Same rule as `releaseSettledPreorder` in
            // `lib/payments/preorder-balance.ts`.
            "subOrders.$[preorderSub].status": nextOrderStatus,
            "subOrders.$[preorderSub].items.$[subItem].preorderStatus":
              nextPreorderStatus,
          },
          // A fresh request is a fresh promise, so the reminders sent against
          // the old one must not silence the new ones (the `delay` action
          // below unsets them for the same reason).
          ...(startsTheBalanceClock
            ? { $unset: { preorderBalanceRemindersSent: "" } }
            : {}),
        },
        {
          returnDocument: "after",
          arrayFilters: [
            { "item.purchaseType": PURCHASE_TYPE.PREORDER },
            { "preorderSub.status": ORDER_STATUS.PREORDERED },
            { "subItem.purchaseType": PURCHASE_TYPE.PREORDER },
          ],
        },
      );
      if (!order) {
        // A concurrent cancel won after stock was consumed — put it back
        // (claim-based, no-ops if the cancel's own restore already ran).
        if (!shouldRequestPayment) {
          await restoreOrderInventory(id).catch((err) =>
            console.error(
              "Failed to restore preorder stock after lost ready/cancel race:",
              err,
            ),
          );
        }
        return notFoundResponse("Pre-order");
      }
      // Released for fulfilment, so it is shippable now. The sweep is what
      // guarantees a label eventually gets bought; this only makes it prompt,
      // exactly as the order status route does on its own move to processing.
      if (!shouldRequestPayment) {
        afterResponse(() => queueAutoShipForOrder(id, session.user.id));
      }

      // The balance is now being asked for, so take it from the card the
      // shopper left rather than asking them for it — that is what they
      // authorised at checkout. A collected balance releases the order and
      // sends its own message, and so does a failed charge, which is why the
      // ask below is only for the orders that nobody has written to.
      const collection = shouldRequestPayment
        ? await collectPreorderBalanceOnRequest(id)
        : { collected: false, shopperAlreadyTold: false };

      if (!collection.shopperAlreadyTold) {
        await notifyPreorderCustomerUpdate(
          String(order.customerId),
          order.orderNumber,
          shouldRequestPayment ? "payment_due" : "ready",
          String(order._id),
          {
            releaseDate: order.preorderReleaseDate,
            outstandingAmount,
            balanceRequestedAt: order.preorderBalanceRequestedAt,
            // Asked again by hand: its own event, not a copy of the first
            // request the dedupe gate would drop.
            ...(shouldRequestPayment && !startsTheBalanceClock
              ? { reminderStage: manualBalanceReminderStage() }
              : {}),
            // A guest order's `customerId` is its cart, so this is the only
            // address the update can reach.
            guestEmail: order.guestEmail,
          },
        ).catch((err) =>
          console.error("Failed to notify preorder customer:", err),
        );
      }
      // Re-read when the money landed: the settle path moved the order on to
      // processing underneath us, and handing the admin the pre-charge copy
      // would show them a balance that is no longer owed.
      return successResponse(
        collection.collected ? ((await Order.findOne(scopeQuery).lean()) ?? order) : order,
      );
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
      const previousReleaseDate = before.preorderReleaseDate;
      // A balance already asked for stays asked for. `delayed` is read by
      // nothing that collects money, so writing it over `payment_due` stopped
      // the card retries, the reminders and the expiry, and a balance paid
      // afterwards released nothing — the order sat there for good. Only a
      // reservation still waiting on its goods becomes `delayed`.
      const keepsBalanceRequest =
        before.preorderStatus === PREORDER_ITEM_STATUS.PAYMENT_DUE;
      const delayStatus = keepsBalanceRequest
        ? {}
        : {
            preorderStatus: PREORDER_ITEM_STATUS.DELAYED,
            "items.$[item].preorderStatus": PREORDER_ITEM_STATUS.DELAYED,
            "subOrders.$[].items.$[subItem].preorderStatus":
              PREORDER_ITEM_STATUS.DELAYED,
          };

      // Not over a cancellation that landed after the read: a new date on an
      // order the shopper has already been refunded for tells them to wait for
      // goods that are not coming. Nor over a balance request or release that
      // landed after it, which the status choice above did not see.
      const order = await Order.findOneAndUpdate(
        {
          ...scopeQuery,
          status: { $ne: ORDER_STATUS.CANCELLED },
          preorderStatus: keepsBalanceRequest
            ? PREORDER_ITEM_STATUS.PAYMENT_DUE
            : { $in: [PREORDER_ITEM_STATUS.RESERVED, PREORDER_ITEM_STATUS.DELAYED] },
        },
        {
          $set: {
            ...delayStatus,
            preorderReleaseDate: releaseDate,
            preorderOriginalReleaseDate:
              before.preorderOriginalReleaseDate ||
              before.preorderReleaseDate ||
              releaseDate,
            preorderDelayReason: reason,
            preorderReleaseDateUpdatedAt: new Date(),
            preorderCustomerNotifiedAt: new Date(),
            statusChangedBy: session.user.id,
            "items.$[item].preorderReleaseDate": releaseDate,
            "subOrders.$[].items.$[subItem].preorderReleaseDate": releaseDate,
          },
          // A new date is a new promise, so the reminders already sent against
          // the old one must not silence the new ones. Without this a shopper
          // whose T-7 went out for the original date is never reminded again,
          // however far the date moves.
          $unset: { preorderBalanceRemindersSent: "" },
        },
        {
          returnDocument: "after",
          arrayFilters: [
            { "item.purchaseType": PURCHASE_TYPE.PREORDER },
            { "subItem.purchaseType": PURCHASE_TYPE.PREORDER },
          ],
        },
      );
      if (!order) {
        throw new ValidationError(
          "This pre-order was cancelled or released while you were updating it — reload it before moving its date",
        );
      }
      await notifyPreorderCustomerUpdate(
        String(order.customerId),
        order.orderNumber,
        "delayed",
        String(order._id),
        {
          releaseDate,
          previousReleaseDate,
          reason,
          guestEmail: order.guestEmail,
        },
      ).catch((err) =>
        console.error("Failed to notify preorder delay customer:", err),
      );
      return successResponse(order);
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
      // Cancelling a pre-order now sends the shopper's money back, so it is a
      // refund as well as a status change. Staff who may cancel but may not
      // refund would otherwise move money through the side door, and letting
      // the cancel through while silently skipping the refund is worse still.
      if (
        getPreorderCollectedAmount(before) > 0 &&
        !canIssueRefunds(session.user)
      ) {
        throw new AuthorizationError(
          "Only an admin can cancel a pre-order that has been paid, because the money has to be refunded",
        );
      }

      // Goods that have left are a return, not a cancellation. This blanket
      // cancel refunded everything, wrote every consignment cancelled — so the
      // restore below no longer recognised the shipped ones and put their units
      // back on sale — and the shopper kept the parcel.
      if (hasDispatchedGoods(before)) {
        throw new ValidationError(
          "Part of this order has already shipped, so it can no longer be cancelled here — cancel the remaining consignments from the order page, or handle it as a return",
        );
      }

      const order = await Order.findOneAndUpdate(
        // The same refusal, held at the write: a parcel dispatched after the
        // read must not be cancelled underneath the courier.
        {
          ...scopeQuery,
          status: { $nin: DISPATCHED_ORDER_STATUSES },
          "subOrders.status": { $nin: DISPATCHED_ORDER_STATUSES },
        },
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
          returnDocument: "after",
          arrayFilters: [
            { "item.purchaseType": PURCHASE_TYPE.PREORDER },
            { "subItem.purchaseType": PURCHASE_TYPE.PREORDER },
          ],
        },
      );
      if (!order) {
        throw new ValidationError(
          "This pre-order shipped while it was being cancelled — reload it and handle it as a return",
        );
      }

      // A released pre-order may already have a label bought for it.
      await voidLabelsForCancellation({ orderId: order._id }).catch((err) =>
        console.error("Failed to void labels on pre-order cancel:", err),
      );

      // If the pre-order was already marked ready, its stock was consumed
      // (sub-orders carry inventoryReserved) — put those units back. The
      // helper claims per sub-order, so never-consumed orders are a no-op.
      await restoreOrderInventory(id).catch((err) =>
        console.error("Failed to restore preorder inventory on cancel:", err),
      );
      await releaseOrderPreorders(id).catch((err) =>
        console.error("Failed to release preorder quota:", err),
      );
      await reverseCouponUsageForOrder(id).catch((err) =>
        console.error("Failed to reverse coupon usage:", err),
      );

      // Cancel means refund — always, whoever cancelled. A failure here is
      // reported rather than thrown: the cancellation stands either way, and
      // an admin needs to be told the money still has to go back by hand.
      const refund = await refundCancelledPreorder({
        orderId: id,
        reason: body.reason?.trim() || "Pre-order cancelled",
        actor: session.user.email || session.user.id,
        createdBy: session.user.id,
        auditContext: createAuditContext(request, session),
      }).catch((err: unknown) => {
        console.error("Failed to refund cancelled pre-order:", err);
        return { refunded: false, reason: "The refund could not be issued" };
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
      ).catch((err) =>
        console.error("Failed to notify preorder cancellation customer:", err),
      );
      return successResponse({ ...order.toObject(), refund });
    }

    throw new ValidationError("Unsupported preorder action");
  },
);
