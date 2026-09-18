import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { toVendorOrderView } from "@/lib/vendors/vendor-order-view";
import { getFulfillmentPaymentBlock } from "@/lib/orders/fulfillment-payment-gate";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { ORDER_STATUS } from "@/config/app.config";
import {
  saveOrderOverReadStatuses,
  snapshotOrderStatuses,
} from "@/lib/orders/order-save-guard";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { isValidObjectId, validateOptionalBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  PREORDER_ITEM_STATUS,
  PURCHASE_TYPE,
  consumePreorderStockOnReady,
  releaseSubOrderPreorders,
} from "@/lib/orders/preorders";
import { deriveOrderStatusFromSubOrders } from "@/lib/orders/order-status-apply";
import { restoreSubOrderInventory } from "@/lib/orders/order-inventory";
import { reverseCouponUsageForOrder } from "@/lib/catalog/coupons";
import { notifyPreorderCustomerUpdate } from "@/lib/notifications/notifications";
import { getPreorderBalanceDue } from "@/lib/orders/order-payment-status";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import { collectPreorderBalanceOnRequest } from "@/lib/payments/preorder-balance-charge";
import {
  getSubOrderPreorderCollectedAmount,
  refundCancelledPreorder,
} from "@/lib/orders/preorder-cancel-refund";
import { createAuditContext } from "@/lib/audit";
import { queueAutoShipForOrder } from "@/lib/shipping/carriers/shipment-worker";
import { afterResponse } from "@/lib/after-response";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";

const VendorPreorderActionSchema = z.object({
  /**
   * `payment_due` is what the shared pre-orders table sends for "Request
   * balance" and "Send balance reminder" in both scopes. `ready` with a
   * balance still owed lands on the same request, as it does for the admin;
   * `payment_due` with nothing owed is refused rather than silently released.
   */
  action: z.enum(["ready", "payment_due", "cancel", "delay"]).optional(),
  /** `delay`: the new expected ship date for this vendor's lines. */
  releaseDate: z.string().max(40).optional(),
  /** `delay`: why, in words the shopper will read. Required for a vendor. */
  reason: z.string().max(1000).optional(),
});

export const PUT = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const user = session.user;
    const canEdit = await hasVendorPermission(
      user,
      VENDOR_PERMISSIONS.EDIT_ORDERS,
    );
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

    const order = await Order.findOne({
      _id: id,
      hasPreorder: true,
      "subOrders.vendorId": vendor._id,
    });
    if (!order) return notFoundResponse("Pre-order");
    // The statuses every decision below is made on. Each save is conditional
    // on them still being true: a cancel landing between this read and the
    // save would otherwise be written back to `preordered` or `processing`,
    // and a label queued for goods the shopper was just refunded for.
    const readStatuses = snapshotOrderStatuses(order);

    const subOrder = order.subOrders.find(
      (sub: { vendorId?: { toString: () => string } }) =>
        sub.vendorId?.toString() === vendor._id.toString(),
    );
    if (!subOrder) return notFoundResponse("Pre-order");

    if (body.action === "ready" || body.action === "payment_due") {
      // A cancelled order/sub-order already had its stock restored and quota
      // released — marking it ready would ship units that are back in
      // sellable stock (the claim flags are spent, a later cancel restores
      // nothing).
      if (
        order.status === ORDER_STATUS.CANCELLED ||
        subOrder.status === ORDER_STATUS.CANCELLED
      ) {
        throw new ValidationError(
          "This pre-order has been cancelled and can no longer be marked ready",
        );
      }
      // Zero once the balance has been paid or recorded — the raw figure
      // stays on the order for good and would re-request money already in.
      const outstandingAmount = getPreorderBalanceDue(order);
      if (body.action === "payment_due" && outstandingAmount <= 0) {
        throw new ValidationError(
          "Nothing is owed on this pre-order — move it to fulfillment instead",
        );
      }

      if (outstandingAmount > 0) {
        // The balance is owed on the whole order, not per seller, so asking
        // for it is the same order-level move the admin route makes. The
        // consignments stay `preordered` until the money is in: marking this
        // one `processing` let it ship unpaid, and left its items stuck on
        // `payment_due` after the shopper paid, because the release on payment
        // (`releaseSettledPreorder`) only moves consignments still waiting. It
        // also rolled a multi-seller order up to `partially_ready`, so the
        // saved card below was never charged.
        order.status = ORDER_STATUS.PREORDERED;
        order.preorderStatus = PREORDER_ITEM_STATUS.PAYMENT_DUE;
        order.statusChangedBy = session.user.id;
        const markPaymentDue = (item: {
          purchaseType?: string;
          preorderStatus?: string;
        }) => {
          if (item.purchaseType === PURCHASE_TYPE.PREORDER) {
            item.preorderStatus = PREORDER_ITEM_STATUS.PAYMENT_DUE;
          }
        };
        order.items.forEach(markPaymentDue);
        order.subOrders.forEach(
          (sub: {
            status?: string;
            items: Array<{ purchaseType?: string; preorderStatus?: string }>;
          }) => {
            if (sub.status === ORDER_STATUS.PREORDERED) {
              sub.items.forEach(markPaymentDue);
            }
          },
        );
        // Only the first request starts the expiry clock; a reminder must not
        // push the deadline out or reset the reminders already sent.
        if (!order.preorderBalanceRequestedAt) {
          order.preorderBalanceRequestedAt = new Date();
          order.preorderBalanceRemindersSent = undefined;
        }
        await saveOrderOverReadStatuses(order, readStatuses);

        // Take the balance off the saved card now that it is genuinely due —
        // the same move the admin route makes, and for the same reason: the
        // shopper authorised this at checkout so that they would not have to
        // be asked. A collected balance releases the order and sends its own
        // message, and so does a failed charge.
        const collection = await collectPreorderBalanceOnRequest(
          String(order._id),
        );
        if (!collection.shopperAlreadyTold) {
          await notifyPreorderCustomerUpdate(
            String(order.customerId),
            order.orderNumber,
            "payment_due",
            String(order._id),
            {
              releaseDate: order.preorderReleaseDate,
              outstandingAmount,
              balanceRequestedAt: order.preorderBalanceRequestedAt,
              // A guest order's `customerId` is its cart — see the notifier.
              guestEmail: order.guestEmail,
            },
          ).catch((err) =>
            console.error("Failed to notify preorder balance customer:", err),
          );
        }
        // The settle path moved the order on when the money landed, so the
        // copy in hand is out of date — re-read rather than report a stale
        // balance.
        return successResponse(
          toVendorOrderView(
            collection.collected
              ? ((await Order.findById(order._id).lean()) ?? order)
              : order,
            vendor._id,
          ),
        );
      }

      // Nothing is owed by the balance rule above, but that rule reads a
      // deposit that never captured as "nothing owed" too — and releasing it
      // would ship a pre-order nobody has paid a penny towards.
      const paymentBlock = getFulfillmentPaymentBlock(order, subOrder);
      if (paymentBlock) throw new ValidationError(paymentBlock);

      const nextPreorderStatus = PREORDER_ITEM_STATUS.READY;

      // "Ready" means this vendor's received units physically exist: consume
      // them and free the shared reservation counter BEFORE transitioning,
      // scoped to this vendor's sub-order only (mirrors the admin endpoints).
      // Insufficient stock aborts the transition so the vendor restocks first.
      const outcome = await consumePreorderStockOnReady(String(order._id), {
        vendorId: String(vendor._id),
      });
      if (!outcome.consumed && !outcome.alreadyConsumed) {
        throw new ValidationError(
          outcome.error || "Failed to allocate stock for this pre-order",
        );
      }

      subOrder.status = ORDER_STATUS.PROCESSING;
      subOrder.items.forEach(
        (item: { purchaseType?: string; preorderStatus?: string }) => {
          if (item.purchaseType === PURCHASE_TYPE.PREORDER) {
            item.preorderStatus = nextPreorderStatus;
          }
        },
      );

      // Is any live consignment still waiting on its pre-order? The roll-up
      // used to ask whether EVERY sub-order was `processing`, which a sibling
      // that had moved on answered wrongly in both directions: one already
      // shipped, or one cancelled, left the order stuck on `partially_ready`
      // for good even though nothing was waiting any more.
      const derived = deriveOrderStatusFromSubOrders(order.subOrders);
      const stillWaiting = derived === ORDER_STATUS.PREORDERED;
      if (!stillWaiting && derived) {
        // Never further back than the consignments themselves: `derived` is
        // the least advanced live one, so an order whose sibling has already
        // shipped stays shipped.
        order.status = derived;
        order.preorderStatus = nextPreorderStatus;
        order.items.forEach(
          (item: { purchaseType?: string; preorderStatus?: string }) => {
            if (item.purchaseType === PURCHASE_TYPE.PREORDER) {
              item.preorderStatus = nextPreorderStatus;
            }
          },
        );
      } else {
        order.preorderStatus = PREORDER_ITEM_STATUS.PARTIALLY_READY;
      }
      // The clock the auto-ship sweep measures from. A pre-order's `createdAt`
      // is months behind the day it becomes shippable, so without this stamp
      // the sweep's recency bound skips it — see `sweepAutoShipCandidates`.
      // Stamped once: a second vendor releasing their own consignment must not
      // restart a window that is already running.
      if (!order.processingAt) {
        order.processingAt = new Date();
      }
      await saveOrderOverReadStatuses(order, readStatuses);

      // Shippable now, so queue a label rather than waiting for the sweep.
      // Eligibility is judged per consignment inside, which is what keeps a
      // sibling that is still waiting on its own stock out of it.
      afterResponse(() =>
        queueAutoShipForOrder(String(order._id), session.user.id),
      );

      await notifyPreorderCustomerUpdate(
        String(order.customerId),
        order.orderNumber,
        order.preorderStatus === PREORDER_ITEM_STATUS.PARTIALLY_READY
          ? "partially_ready"
          : "ready",
        String(order._id),
        {
          releaseDate: order.preorderReleaseDate,
          // A guest order's `customerId` is its cart — see the notifier.
          guestEmail: order.guestEmail,
        },
      ).catch((err) =>
        console.error("Failed to notify preorder ready customer:", err),
      );
      return successResponse(toVendorOrderView(order, vendor._id));
    }

    if (body.action === "delay") {
      // The vendor is the one who knows when the goods will actually arrive,
      // and until this only an admin could say so — a seller whose supplier
      // slipped had to ask someone else to tell their own customer. Scoped to
      // this vendor's lines: on a split order the other sellers' dates are
      // theirs to move, not this one's.
      if (
        order.status === ORDER_STATUS.CANCELLED ||
        subOrder.status === ORDER_STATUS.CANCELLED
      ) {
        throw new ValidationError(
          "This pre-order has been cancelled and can no longer be updated",
        );
      }
      // Once released the goods are this vendor's to ship, not to promise.
      if (subOrder.status !== ORDER_STATUS.PREORDERED) {
        throw new ValidationError(
          "This consignment has already been released, so its date can no longer change",
        );
      }

      const releaseDate = body.releaseDate ? new Date(body.releaseDate) : null;
      if (!releaseDate || Number.isNaN(releaseDate.getTime())) {
        throw new ValidationError("A valid release date is required");
      }
      // A date input sends midnight UTC, which in the store's own timezone can
      // already be "yesterday" for today's date — a day of slack keeps today
      // selectable without letting a genuinely past date through.
      const DAY_MS = 24 * 60 * 60 * 1000;
      if (releaseDate.getTime() < Date.now() - DAY_MS) {
        throw new ValidationError("The new release date cannot be in the past");
      }
      // The same ceiling a vendor meets when they first set the date: a delay
      // is not a way around the store's limit on how far ahead to promise.
      const { maxLeadDays } = resolvePreorderPolicy(settings.preorder);
      if (releaseDate.getTime() > Date.now() + maxLeadDays * DAY_MS) {
        throw new ValidationError(
          `The release date can be at most ${maxLeadDays} days from today`,
        );
      }

      // Required of a vendor, where an admin may leave it blank: the shopper is
      // being asked whether to keep waiting, and "the date changed" with no why
      // is not enough to decide on.
      const reason =
        typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
      if (!reason) {
        throw new ValidationError(
          "Tell the customer why the date is changing",
        );
      }

      const vendorKey = vendor._id.toString();
      type DatedLine = { purchaseType?: string; preorderReleaseDate?: Date };
      const latestPreorderDate = (lines: DatedLine[]) =>
        lines.reduce<Date | undefined>((max, item) => {
          if (item.purchaseType !== PURCHASE_TYPE.PREORDER) return max;
          const date = item.preorderReleaseDate
            ? new Date(item.preorderReleaseDate)
            : undefined;
          if (!date || Number.isNaN(date.getTime())) return max;
          return !max || date.getTime() > max.getTime() ? date : max;
        }, undefined);

      // What THIS vendor had promised, which is what the shopper is told moved.
      // The order's own date is its latest line: on a split order where another
      // seller's goods come later, it would not move at all, and the notice
      // would read "changed from 1 Nov to 1 Nov".
      const previousReleaseDate =
        latestPreorderDate(subOrder.items as DatedLine[]) ||
        order.preorderReleaseDate;
      const markDelayed = (item: {
        purchaseType?: string;
        preorderReleaseDate?: Date;
        preorderStatus?: string;
      }) => {
        if (item.purchaseType === PURCHASE_TYPE.PREORDER) {
          item.preorderReleaseDate = releaseDate;
          item.preorderStatus = PREORDER_ITEM_STATUS.DELAYED;
        }
      };
      subOrder.items.forEach(markDelayed);
      order.items.forEach(
        (item: {
          vendorId?: { toString: () => string };
          purchaseType?: string;
          preorderReleaseDate?: Date;
          preorderStatus?: string;
        }) => {
          if (item.vendorId?.toString() === vendorKey) markDelayed(item);
        },
      );

      // The order waits for its LATEST line, so that is the date the shopper
      // is shown — and the one the reminders, the expiry clock and the auto
      // release all count from.
      const latest = latestPreorderDate(order.items as DatedLine[]);

      order.preorderOriginalReleaseDate =
        order.preorderOriginalReleaseDate || previousReleaseDate || releaseDate;
      order.preorderReleaseDate = latest || releaseDate;
      order.preorderStatus = PREORDER_ITEM_STATUS.DELAYED;
      order.preorderDelayReason = reason;
      order.preorderReleaseDateUpdatedAt = new Date();
      order.preorderCustomerNotifiedAt = new Date();
      order.statusChangedBy = session.user.id;
      // A new date is a new promise, so the reminders sent against the old one
      // must not silence the new ones — the same rule as the admin delay.
      order.preorderBalanceRemindersSent = undefined;
      await saveOrderOverReadStatuses(order, readStatuses);

      await notifyPreorderCustomerUpdate(
        String(order.customerId),
        order.orderNumber,
        "delayed",
        String(order._id),
        {
          // This vendor's new date, not the order's: see `previousReleaseDate`.
          releaseDate,
          previousReleaseDate,
          reason,
          // A guest order's `customerId` is its cart — see the notifier.
          guestEmail: order.guestEmail,
        },
      ).catch((err) =>
        console.error("Failed to notify customer of a vendor delay:", err),
      );
      return successResponse(toVendorOrderView(order, vendor._id));
    }

    if (body.action === "cancel") {
      const canDelete = await hasVendorPermission(
        user,
        VENDOR_PERMISSIONS.DELETE_ORDERS,
      );
      if (!canDelete && !canManage && !isAdmin(user)) {
        throw new AuthorizationError("You do not have permission to cancel orders");
      }

      // Once. The refund below is measured off the order's money fields, which
      // a cancellation never changes, so a consignment cancelled a second time
      // sent its share back a second time — paid out of whatever the other
      // sellers' goods had brought in, since only the order-wide total capped
      // it.
      if (subOrder.status === ORDER_STATUS.CANCELLED) {
        throw new ValidationError("This consignment has already been cancelled");
      }
      // Goods that have left are a return, not a cancellation. Cancelling one
      // here refunded the shopper while they kept the parcel.
      if (
        subOrder.status === ORDER_STATUS.SHIPPED ||
        subOrder.status === ORDER_STATUS.DELIVERED
      ) {
        throw new ValidationError(
          "This consignment has already shipped, so it can no longer be cancelled — handle it as a return instead",
        );
      }
      // Claimed before anything moves, conditional on the status just checked:
      // two cancels sent together both pass the checks above on the same read,
      // and without this both would refund.
      const claim = await Order.updateOne(
        {
          _id: order._id,
          subOrders: {
            $elemMatch: { _id: subOrder._id, status: subOrder.status },
          },
        },
        { $set: { "subOrders.$.status": ORDER_STATUS.CANCELLED } },
      );
      if (!claim.modifiedCount) {
        throw new ValidationError(
          "This consignment changed while it was being cancelled — reload it and try again",
        );
      }

      subOrder.status = ORDER_STATUS.CANCELLED;
      subOrder.items.forEach(
        (item: { purchaseType?: string; preorderStatus?: string }) => {
          if (item.purchaseType === PURCHASE_TYPE.PREORDER) {
            item.preorderStatus = PREORDER_ITEM_STATUS.CANCELLED;
          }
        },
      );

      const statuses: string[] = order.subOrders.map(
        (sub: { status: string }) => sub.status,
      );
      if (statuses.every((status) => status === ORDER_STATUS.CANCELLED)) {
        order.status = ORDER_STATUS.CANCELLED;
        order.preorderStatus = PREORDER_ITEM_STATUS.CANCELLED;
        order.cancelledAt = new Date();
        order.items.forEach(
          (item: { purchaseType?: string; preorderStatus?: string }) => {
            if (item.purchaseType === PURCHASE_TYPE.PREORDER) {
              item.preorderStatus = PREORDER_ITEM_STATUS.CANCELLED;
            }
          },
        );
      }
      // Measured off the order's own money fields, which the cancellation
      // above does not touch — the consignment's share of what was charged is
      // the same figure before and after. Taken here rather than inside the
      // refund call so the refund helper stays free of sub-order shapes.
      const cancelledShare = getSubOrderPreorderCollectedAmount(
        order.toObject(),
        subOrder,
      );

      // Written as conditional updates, not a save of the document read above.
      // The claim already moved this consignment; saving the whole order
      // would write every sibling's status back as it was read — undoing a
      // sibling cancelled or shipped in the meantime — and deciding "was that
      // the last one" from that stale read could leave a fully cancelled order
      // live, or cancel one still shipping.
      await Order.updateOne(
        { _id: order._id },
        {
          $set: {
            "subOrders.$[mine].items.$[line].preorderStatus":
              PREORDER_ITEM_STATUS.CANCELLED,
            statusChangedBy: session.user.id,
          },
        },
        {
          arrayFilters: [
            { "mine._id": subOrder._id },
            { "line.purchaseType": PURCHASE_TYPE.PREORDER },
          ],
        },
      );
      // The order goes only when no consignment is left live, judged by the
      // database at the moment of writing.
      const closed = await Order.updateOne(
        {
          _id: order._id,
          status: { $ne: ORDER_STATUS.CANCELLED },
          subOrders: {
            $not: { $elemMatch: { status: { $ne: ORDER_STATUS.CANCELLED } } },
          },
        },
        {
          $set: {
            status: ORDER_STATUS.CANCELLED,
            preorderStatus: PREORDER_ITEM_STATUS.CANCELLED,
            cancelledAt: new Date(),
            "items.$[line].preorderStatus": PREORDER_ITEM_STATUS.CANCELLED,
          },
        },
        { arrayFilters: [{ "line.purchaseType": PURCHASE_TYPE.PREORDER }] },
      );
      // What the response reports follows what was actually written.
      if (!closed.modifiedCount && order.status === ORDER_STATUS.CANCELLED) {
        const fresh = await Order.findById(order._id)
          .select("status")
          .lean<{ status?: string } | null>();
        if (fresh?.status) order.status = fresh.status;
      }

      // If this vendor's sub-order was already marked ready, its stock was
      // consumed (inventoryReserved) — put those units back. Claim-based, so
      // a never-consumed sub-order is a no-op.
      await restoreSubOrderInventory({
        orderId: String(order._id),
        vendorId: String(vendor._id),
      }).catch((err) =>
        console.error(
          "Failed to restore vendor preorder inventory on cancel:",
          err,
        ),
      );
      await releaseSubOrderPreorders({
        orderId: String(order._id),
        vendorId: String(vendor._id),
      }).catch((err) =>
        console.error("Failed to release vendor preorder quota:", err),
      );
      if (order.status === ORDER_STATUS.CANCELLED) {
        await reverseCouponUsageForOrder(String(order._id)).catch((err) =>
          console.error("Failed to reverse coupon usage:", err),
        );
      }

      // Cancel means refund — whoever cancelled. This path did not, so a
      // vendor calling off their own pre-order kept the shopper's deposit,
      // against the policy the product page states and the admin route and
      // the expiry job both keep.
      //
      // Scoped to THIS consignment unless the cancellation took the whole
      // order with it: on a split order the shopper is still receiving, and
      // still paying for, everybody else's goods. A failure is reported, not
      // thrown — the cancellation stands either way, and somebody has to be
      // told the money still needs sending back by hand.
      const wholeOrderCancelled = order.status === ORDER_STATUS.CANCELLED;
      const refund = await refundCancelledPreorder({
        orderId: String(order._id),
        reason: wholeOrderCancelled
          ? "Pre-order cancelled by the seller"
          : "Pre-order consignment cancelled by the seller",
        actor: session.user.email || session.user.id,
        createdBy: session.user.id,
        auditContext: createAuditContext(request, session),
        ...(wholeOrderCancelled ? {} : { collected: cancelledShare }),
      }).catch((err: unknown) => {
        console.error("Failed to refund cancelled vendor pre-order:", err);
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
      return successResponse({ ...toVendorOrderView(order, vendor._id), refund });
    }

    throw new ValidationError("Unsupported preorder action");
  },
);
