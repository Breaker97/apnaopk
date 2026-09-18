import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { z } from "zod";
import { hasVendorPermission, isAdmin, assertVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { PAYMENT_STATUS } from "@/config/app.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { UpdateOrderStatusSchema } from "@/lib/validations";
import { auditUpdate, createAuditContext } from "@/lib/audit";
import { auditOrderCancelled, auditOrderStatus } from "@/lib/orders/audit-order";
import { restoreSubOrderInventory } from "@/lib/orders/order-inventory";
import { releaseSubOrderPreorders } from "@/lib/orders/preorders";
import {
  getOrderStatusActionByTarget,
  getOrderStatusTimestampUpdates,
} from "@/lib/orders/order-status-workflow";
import { rollUpOrderStatus } from "@/lib/orders/order-status-apply";
import {
  getFulfillmentPaymentBlock,
  isFulfillmentTransition,
} from "@/lib/orders/fulfillment-payment-gate";
import { toVendorOrderView } from "@/lib/vendors/vendor-order-view";
import {
  deriveOrderPaymentStatus,
  resolveSubOrderPaymentStatus,
  resolveVendorPaymentDisplayStatus,
} from "@/lib/orders/order-payment-status";
import { isPlatformSettled } from "@/lib/payments/payment-custody";
import { reverseCouponUsageForOrder } from "@/lib/catalog/coupons";
import { refundOrderCancellation } from "@/lib/orders/preorder-cancel-refund";
import { notifyOrderStatus } from "@/lib/notifications/notifications";
import { ensureChargeTransaction } from "@/lib/payments/payment-transactions";
import { withApi } from "@/lib/api/handler";
import { afterResponse } from "@/lib/after-response";
import { queueAutoShipForOrder } from "@/lib/shipping/carriers/shipment-worker";
import { consignmentCharge } from "@/lib/finance/postings";
import {
  fetchRefundTotalsByOrder,
  payableInCurrency,
  sumVendorPayable,
} from "@/lib/vendors/vendor-earnings";
import { resolveReturnPolicy } from "@/lib/returns/return-policy";
import type { IOrder } from "@/types";

/** Commission billed on a sale, less the store's own promotion on it. */
function billedAfterPromotions(totals: {
  commissionAmount: number;
  promotionCredit: number;
}): number {
  return Math.max(
    0,
    Math.round((totals.commissionAmount - totals.promotionCredit) * 100) / 100,
  );
}

const VendorUpdateOrderSchema = UpdateOrderStatusSchema.partial()
  .extend({
    paymentStatus: z.literal(PAYMENT_STATUS.PAID).optional(),
    carrier: z.string().trim().max(100).optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.trackingNumber !== undefined ||
      value.carrier !== undefined ||
      value.paymentStatus !== undefined,
    { message: "No updates provided" },
  );

/**
 * GET /api/vendor/orders/[id]
 * Get a single order by ID (vendor's sub-order only)
 * Requires: VIEW_ORDERS permission
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    // Check RBAC permission
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_ORDERS,
      "You do not have permission to view orders",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:orders:read",
      "lenient",
      session.user.role
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    if (!vendor) throw new AuthorizationError("Vendor profile not found");

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Order");
    const order = await Order.findOne({
      _id: id,
      "subOrders.vendorId": vendor._id,
    })
      .populate("customerId", "name email")
      .lean<IOrder & { customerId?: { name?: string; email?: string } }>();
    const subOrder = order?.subOrders.find(
      (sub) => String(sub.vendorId) === String(vendor._id),
    );

    if (!order || !subOrder) {
      return notFoundResponse("Order");
    }

    const currency = String(
      order.currency || settings.general?.defaultCurrency || "USD",
    ).toUpperCase();
    const refunds = await fetchRefundTotalsByOrder([order._id]);
    // The payout arithmetic, not the sub-order's face values: those are
    // undiscounted and pre-refund, so a couponed or refunded order showed the
    // vendor earnings no payout would ever pay.
    const settle = (billVendorCodShipping: boolean) =>
      payableInCurrency(
        sumVendorPayable([order], vendor._id, refunds, () => true, currency, {
          billVendorCodShipping,
        }),
        currency,
      );
    const earnings = settle(false);
    const vendorCollects = !isPlatformSettled(order, subOrder);

    // An allow-list, not the order. Spreading the document shipped every
    // vendor's lines on a split order — unit cost included — and the store's
    // payment references to whichever vendor opened it.
    return successResponse({
      _id: order._id,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      paymentMethod: order.paymentMethod,
      // This vendor's own payment state. The order-level one read "Partially
      // paid" to a vendor whose share had already arrived.
      paymentStatus: resolveVendorPaymentDisplayStatus(order, subOrder),
      shippingAddress: order.shippingAddress,
      customerId: order.customerId,
      // What the shopper wrote at checkout is often for whoever packs the
      // parcel ("leave with the guard", a gift message).
      customerNote: order.customerNote,
      checkoutFields: order.checkoutFields,
      subOrders: [subOrder],
      finance: {
        currency,
        // What the shopper is charged for THIS consignment — the figure a
        // courier collects at the door, and the one the ledger books as cash.
        charge: consignmentCharge({ ...order, currency }, subOrder._id),
        grossSales: earnings.grossSales,
        commission: earnings.commissionAmount,
        earnings: earnings.netAmount,
        vendorCollects,
        // What the store bills a vendor who keeps the cash: the commission,
        // plus the delivery they took at the door when the store bills it back.
        billedToVendor: vendorCollects
          ? billedAfterPromotions(
              settle(resolveReturnPolicy(settings).billVendorCodShipping),
            )
          : 0,
        // The store's own promotion on this sale, owed to a vendor who
        // collected the discounted price — already netted off the bill above.
        storePromotion: vendorCollects ? earnings.promotionCredit : 0,
      },
    });
  },
);

/**
 * PUT /api/vendor/orders/[id]
 * Update vendor's sub-order status (e.g., shipped, delivered)
 * Requires: EDIT_ORDERS permission
 */
export const PUT = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    // Check RBAC permission
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.EDIT_ORDERS,
      "You do not have permission to edit orders",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:orders:update",
      "moderate",
      session.user.role
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    if (!vendor) throw new AuthorizationError("Vendor profile not found");

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Order");

    const { status, trackingNumber, carrier, paymentStatus } = await validateBody(
      request,
      VendorUpdateOrderSchema,
    );
    if (status === "cancelled") {
      const hasDeletePermission = await hasVendorPermission(
        user,
        VENDOR_PERMISSIONS.DELETE_ORDERS,
      );
      if (!hasDeletePermission && !isAdmin(user)) {
        throw new AuthorizationError(
          "You do not have permission to cancel orders",
        );
      }
    }

    const order = await Order.findOne({
      _id: id,
      "subOrders.vendorId": vendor._id,
    });

    if (!order) {
      return notFoundResponse("Order");
    }

    // Find and update vendor's sub-order
    const subOrderIndex = order.subOrders.findIndex(
      (sub: { vendorId?: { toString: () => string } }) =>
        sub.vendorId?.toString() === vendor._id.toString(),
    );

    if (subOrderIndex === -1) {
      return notFoundResponse("Sub-order");
    }

    const before = order.toObject() as unknown as Record<string, unknown>;
    const currentSubStatus = order.subOrders[subOrderIndex].status as string;
    const isPickupSubOrder =
      order.subOrders[subOrderIndex].fulfillment?.method === "pickup";

    if (isPickupSubOrder && (status || trackingNumber || carrier)) {
      if (status === "cancelled") {
        // Cancellation follows the existing order workflow and frees capacity
        // below. All other pickup changes must use the dedicated lifecycle API.
      } else {
        throw new ValidationError(
          "Use the pickup actions to mark this order ready or collected",
        );
      }
    }

    // A vendor marks THEIR OWN consignment collected, never the order. On a
    // split order the sibling's cash is still outstanding, and saying
    // otherwise told the courier to stop collecting it
    // (`lib/shipping/carriers/build-request.ts`), unlocked the sibling's
    // digital files and opened a payout on money that had never arrived.
    if (paymentStatus === PAYMENT_STATUS.PAID) {
      // Custody gate. "Mark as paid" is a vendor reporting money they are
      // holding — cash over their counter, COD from their own hands. When the
      // money settles onto the PLATFORM's gateway credentials, the vendor
      // never touches it and has nothing to report: only the gateway (or an
      // admin reconciling it) can say it arrived. Without this a vendor could
      // mark a card order paid that never captured, and — now that the payout
      // filter admits `partially_paid` — collect on it.
      if (isPlatformSettled(order, order.subOrders[subOrderIndex])) {
        throw new ValidationError(
          String(order.paymentMethod || "").toLowerCase() === "cod"
            ? "This delivery is collected by the store's courier, so the store records the payment — not the vendor."
            : "This order is settled through the store's payment gateway. Its payment status is set by the gateway, not by the vendor.",
        );
      }

      const currentSubPayment = resolveSubOrderPaymentStatus(
        order,
        order.subOrders[subOrderIndex],
      );
      if (
        currentSubPayment !== PAYMENT_STATUS.PENDING &&
        currentSubPayment !== PAYMENT_STATUS.PARTIALLY_PAID
      ) {
        throw new ValidationError("Only unpaid orders can be marked as paid");
      }
      order.subOrders[subOrderIndex].paymentStatus = PAYMENT_STATUS.PAID;
      order.subOrders[subOrderIndex].paidAt = new Date();
      // The first money on the order, if this is it.
      if (!order.paidAt) order.paidAt = order.subOrders[subOrderIndex].paidAt;
      order.subOrders[subOrderIndex].paymentCollectedBy = session.user.id;
      order.paymentStatus = deriveOrderPaymentStatus(order);
    }

    if (status) {
      // Validate sub-order status transition
      const transition = getOrderStatusActionByTarget(currentSubStatus, status);
      if (!transition) {
        throw new ValidationError(
          `Cannot transition sub-order from "${currentSubStatus}" to "${status}"`
        );
      }

      // Goods do not move towards a shopper whose payment never arrived — see
      // the gate for what counts. Cancelling is never gated.
      if (isFulfillmentTransition(status)) {
        const blocked = getFulfillmentPaymentBlock(
          order,
          order.subOrders[subOrderIndex],
        );
        if (blocked) throw new ValidationError(blocked);
      }

      order.subOrders[subOrderIndex].status = status;

      if (status === "shipped") {
        order.subOrders[subOrderIndex].shippedAt = new Date();
      }

      if (status === "delivered") {
        order.subOrders[subOrderIndex].deliveredAt = new Date();
      }
    }

    // Outside the status branch: a vendor may add the AWB, or correct the
    // courier, on a parcel that already shipped — and the schema explicitly
    // admits a body carrying only tracking details, which writing these inside
    // the status branch silently dropped.
    //
    // Both are mirrored onto the order, because that is where the public
    // tracking page reads them from: a vendor who marked a parcel shipped with
    // a tracking number showed the customer nothing to track. On a split order
    // the order-level pair is a "most recent shipment" summary — the same
    // convention `buildOrderStatusUpdates` follows for the admin and carrier
    // paths — and the per-consignment truth stays on the sub-order, which the
    // tracking page now renders per seller.
    if (trackingNumber) {
      order.subOrders[subOrderIndex].trackingNumber = trackingNumber;
      order.trackingNumber = trackingNumber;
    }

    if (carrier) {
      order.subOrders[subOrderIndex].carrier = carrier;
      order.carrier = carrier;
    }

    // The order is a wrapper around consignments, so its status is derived
    // from theirs rather than guessed at here — see
    // `deriveOrderStatusFromSubOrders` for why "least advanced live one" is
    // the honest summary. Never backwards, though: see `rollUpOrderStatus`.
    const derivedStatus = rollUpOrderStatus(order.status, order.subOrders);
    if (derivedStatus) {
      // The order's own timestamps go with it. Nothing else on this path writes
      // them — the model has no status hook — so an order derived to `shipped`
      // or `delivered` by a vendor kept an empty `shippedAt`/`deliveredAt`: the
      // public tracking timeline had no date to print, and the return window is
      // measured from `deliveredAt`.
      Object.assign(order, getOrderStatusTimestampUpdates(derivedStatus));
      order.status = derivedStatus;
    }

    const previousOverallStatus = (before as { status?: string })?.status;
    const previousPaymentStatus = (before as { paymentStatus?: string })
      ?.paymentStatus;

    // Written only over the order exactly as it was read. The transition, the
    // roll-up and everything after the save were decided against that copy,
    // and a plain save wrote over whatever had happened since: a consignment
    // the shopper had just been refunded for came back as "shipped" from a
    // vendor's open tab, and two sellers cancelling at once each saw the other
    // still live, leaving an order with nothing left in it reading
    // "processing". Any status on the order that moved in between makes this
    // save match nothing, and the vendor is asked to look again.
    const readStatuses: Record<string, unknown> = { status: previousOverallStatus };
    (
      ((before as { subOrders?: Array<{ status?: string }> }).subOrders || [])
    ).forEach((sub, index) => {
      readStatuses[`subOrders.${index}.status`] = sub.status;
    });
    (order as unknown as { $where?: Record<string, unknown> }).$where =
      readStatuses;
    try {
      await order.save();
    } catch (err) {
      if ((err as { name?: string })?.name === "DocumentNotFoundError") {
        throw new ConflictError(
          "This order changed while you were updating it. Refresh the page and try again.",
        );
      }
      throw err;
    }

    // Restore inventory for vendor's items when sub-order is cancelled — only
    // once the cancellation is saved, so a save that lost the race above hands
    // nothing back. The helper claims the restore atomically, so a sub-order
    // that was never reserved (abandoned pending order) is a no-op; one that
    // has already been restored cannot be restored a second time.
    if (status === "cancelled" && currentSubStatus !== "cancelled") {
      await restoreSubOrderInventory({
        orderId: String(order._id),
        vendorId: String(vendor._id),
      }).catch((err) =>
        console.error(
          "Failed to restore inventory on vendor sub-order cancel:",
          err,
        ),
      );
      await releaseSubOrderPreorders({
        orderId: String(order._id),
        vendorId: String(vendor._id),
      }).catch((err) =>
        console.error(
          "Failed to release preorder quota on vendor sub-order cancel:",
          err,
        ),
      );
      // A label bought for goods that are now staying put was paid for the
      // moment it was bought. Only one never handed to the carrier is voided.
      const { voidLabelsForCancellation } = await import(
        "@/lib/shipping/cancel-labels"
      );
      await voidLabelsForCancellation({
        orderId: order._id,
        subOrderId: order.subOrders[subOrderIndex]._id,
      }).catch((err) =>
        console.error("Failed to void labels on vendor sub-order cancel:", err),
      );
    }

    // A vendor marking a cash order collected is the moment that money became
    // real, and it is the ONLY moment for a COD or pickup sale — no gateway
    // webhook is ever going to arrive. Without this the charge row stayed
    // "pending" forever: the order read as paid while the ledger disagreed, and
    // a later refund landed against a charge that never succeeded.
    //
    // Gated on the ORDER reaching paid, which on a split order means the last
    // vendor collecting. A charge row is one row per order carrying the order
    // total, and tax and discounts are not apportioned per consignment — so
    // writing one when the first of three vendors collects would book the full
    // order value against a third of the money. The alternative, inventing an
    // allocation, would put a number in the ledger that no sub-order can
    // justify. Partial collection lives on the sub-orders until it is whole.
    //
    // Mirrors the admin route's equivalent. Never fails the request — the
    // status change is the vendor's action and has already been saved; a
    // ledger row that failed to write is a reconcilable gap, not a reason to
    // tell them their collection did not register.
    //
    // The LEDGER is not gated the same way, because it does apportion: entries
    // are keyed and sized per consignment, so this vendor's collection posts
    // this vendor's sale and the sibling's posts when it happens. Waiting for
    // the whole order left a payout — which the filter admits on a part-paid
    // order — debiting a payable no sale had ever credited.
    if (paymentStatus === PAYMENT_STATUS.PAID) {
      const { postOrderPaidSafely } = await import("@/lib/finance/post-events");
      postOrderPaidSafely(order._id);
    }

    if (
      order.paymentStatus === PAYMENT_STATUS.PAID &&
      previousPaymentStatus !== PAYMENT_STATUS.PAID
    ) {
      const settings = await getSettings();
      await ensureChargeTransaction({
        _id: String(order._id),
        orderNumber: order.orderNumber,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        paymentId: order.paymentId,
        stripePaymentIntentId: order.stripePaymentIntentId,
        paypalCaptureId: order.paypalCaptureId,
        razorpayPaymentId: order.razorpayPaymentId,
        paystackTransactionId: order.paystackTransactionId,
        pesapalConfirmationCode: order.pesapalConfirmationCode,
        subtotal: order.subtotal,
        shippingCost: order.shippingCost,
        tax: order.tax,
        discount: order.discount,
        total: order.total,
        paymentFee: order.paymentFee,
        paymentFeeCurrency: order.paymentFeeCurrency,
        paymentFeeRate: order.paymentFeeRate,
        currency: settings.general?.defaultCurrency,
        channel: order.channel || "online",
        posLocationId: order.posLocationId
          ? String(order.posLocationId)
          : undefined,
        createdAt: order.createdAt,
      }).catch((err) =>
        console.error(
          "Failed to record charge transaction on vendor mark-as-paid:",
          err,
        ),
      );

      const { awardOrderLoyaltyPoints, refreshCustomerStatsForOrder } =
        await import("@/lib/customers/customer");
      await awardOrderLoyaltyPoints(String(order._id)).catch((err) =>
        console.error("Failed to award loyalty points:", err),
      );
      // COD money is only counted at this transition, so the customer's cached
      // stats (registered or guest — the helper routes by the order) go stale
      // without a refresh here.
      refreshCustomerStatsForOrder(order).catch((err) =>
        console.error("Failed to refresh customer stats:", err),
      );
    }

    // The shopper is told about the ORDER, and only when the order itself
    // moved. A seller cancelling their own consignment of a split order used
    // to send "your order has been cancelled" — by email and SMS — while the
    // other sellers' items were still on their way; a seller shipping their
    // part said the whole order had shipped. The rolled-up status is the only
    // one the message is true about. The admin consignment path does the same.
    if (status && String(order.status) !== String(previousOverallStatus || "")) {
      await notifyOrderStatus({
        orderId: String(order._id),
        status: String(order.status),
      }).catch((err) =>
        console.error("Failed to create vendor order status notification:", err),
      );
    }

    if (
      order.status === "cancelled" &&
      previousOverallStatus !== "cancelled"
    ) {
      await reverseCouponUsageForOrder(String(order._id)).catch((err) =>
        console.error("Failed to reverse coupon usage on vendor cancel:", err),
      );
    }

    // Same prompt-not-authoritative kick as the admin route: the eligibility
    // check runs per sub-order, so only this vendor's parcel is queued.
    if (status === "processing") {
      afterResponse(() =>
        queueAutoShipForOrder(String(order._id), session.user.id),
      );
    }

    const auditContext = createAuditContext(request, session);

    // A vendor moves their OWN sub-order; the overall order status is derived
    // from all sub-orders above. Record the sub-order transition (naming the
    // vendor, since on a split order several parties move independently) and
    // only record an overall transition when it actually changed.
    if (status && status !== currentSubStatus) {
      const vendorName = vendor.storeName || undefined;
      if (status === "cancelled") {
        await auditOrderCancelled(auditContext, order, {
          from: currentSubStatus,
          by: "admin",
          reason: vendorName
            ? `${vendorName} cancelled their items`
            : "Vendor cancelled their items",
        });
      } else {
        await auditOrderStatus(auditContext, order, {
          from: currentSubStatus,
          to: status,
          reason: vendorName ? `${vendorName}'s items` : undefined,
        });
      }
    }

    if (order.status !== previousOverallStatus) {
      await auditOrderStatus(auditContext, order, {
        from: String(previousOverallStatus),
        to: String(order.status),
        reason: "all vendor shipments",
      });
    }

    await auditUpdate(
      auditContext,
      "order",
      id,
      before,
      order.toObject() as unknown as Record<string, unknown>,
    );

    // A vendor calling off a consignment the shopper already paid for sends
    // that consignment's share back — the pre-order screen did, and this one
    // restocked the goods and kept the money. Only this consignment's share
    // unless the cancellation took the whole order with it. Reported, never
    // thrown: the cancellation has been saved and stands either way.
    const refund =
      status === "cancelled" && currentSubStatus !== "cancelled"
        ? await refundOrderCancellation({
            orderId: String(order._id),
            cancelledSubOrderIds: [order.subOrders[subOrderIndex]._id],
            reason: vendor.storeName
              ? `${vendor.storeName} cancelled their items`
              : "Consignment cancelled by the seller",
            actor: session.user.email || session.user.id,
            createdBy: session.user.id,
            auditContext,
          }).catch((err: unknown) => {
            console.error("Failed to refund vendor-cancelled consignment:", err);
            return { refunded: false, reason: "The refund could not be issued" };
          })
        : undefined;

    // This vendor's view of the order, never the document — see the helper.
    const view = toVendorOrderView(order, vendor._id);
    return successResponse(refund ? { ...view, refund } : view);
  },
);
