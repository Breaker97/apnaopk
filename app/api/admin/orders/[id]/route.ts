import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { InventoryLocation } from "@/models/inventory-location.model";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import {
  handleApiError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
} from "@/lib/api/errors";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { getSettings } from "@/models/settings.model";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { AdminUpdateOrderSchema } from "@/lib/validations";
import {
  ADDRESS_HOLD_SHIPPING_BLOCK,
  isAddressHoldOpen,
} from "@/lib/orders/address-hold-policy";
import { auditDelete, auditUpdate, createAuditContext } from "@/lib/audit";
import {
  auditOrderCancelled,
  auditOrderRefunded,
  auditOrderStatus,
  auditOrderStatusOverride,
} from "@/lib/orders/audit-order";
import {
  reserveCancelledOrderInventory,
  restoreOrderInventory,
} from "@/lib/orders/order-inventory";
import { releaseOrderPreorders } from "@/lib/orders/preorders";
import {
  assertAdminOrStaffPermissions,
  assertVendorStaffMayChangeOrder,
} from "@/lib/access/staff-authz";
import { canIssueRefunds } from "@/lib/access/rbac";
import {
  allocateOrderRefund,
  scaleRefundAllocation,
  type RefundAllocationShare,
} from "@/lib/returns/refund-allocation";
import {
  vendorHeldRefundShares,
  type VendorHeldRefundShare,
} from "@/lib/returns/refund-settlement";
import {
  orderStoreCreditRefundProblem,
  refundToStoreCredit,
} from "@/lib/store-credit/refund-to-credit";
import {
  orderGatewayRefundRoom,
  splitRefundCreditFirst,
} from "@/lib/store-credit/order-credit";
import {
  openReturnQuantitiesByIndex,
  refundedDeliveryTotal,
  refundedQuantitiesByIndex,
} from "@/lib/returns/return-plan";
import { quantizeToCurrency } from "@/lib/intl/money";
import { orderRefundRoom } from "@/lib/orders/order-refund-room";
import { closeReturnsRefundedByOrder } from "@/lib/returns/close-refunded-returns";
import { settleRefundedPaymentStatus } from "@/lib/orders/refund-payment-status";
import {
  resolveOrderReturnPolicy,
  unrefundableDeliveryFor,
} from "@/lib/returns/return-policy";
import { isFreeShippingCouponType } from "@/lib/catalog/discounts";

/** Money in a message, without dragging a currency formatter into a route. */
const formatAmount = (value: number) => value.toFixed(2);
import {
  buildStaffOrderScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import { ORDER_STATUS, PAYMENT_STATUS, USER_ROLES } from "@/config/app.config";
import {
  createRefundTransaction,
  ensureChargeTransaction,
} from "@/lib/payments/payment-transactions";
import { refundOrderPayment } from "@/lib/orders/order-refund";
import { assertManualPaymentStatusChange } from "@/lib/orders/manual-payment-status";
import { getPreorderCollectedAmount } from "@/lib/orders/order-payment-status";
import {
  getOrderRefundCeiling,
  refundOrderCancellation,
} from "@/lib/orders/preorder-cancel-refund";
import {
  logRefundInFlightReleaseError,
  releaseRefundInFlightWrite,
} from "@/lib/orders/refund-in-flight";
import {
  adoptReportedGatewayRefund,
  refundReconciledByWebhook,
} from "@/lib/orders/order-refund-sync";
import { settleRefundRecordedLate } from "@/lib/orders/refund-recorded-late";
import {
  getFulfillmentPaymentBlock,
  isFulfillmentTransition,
} from "@/lib/orders/fulfillment-payment-gate";
import {
  DISPUTE_GATEWAY_LABEL,
  disputeGatewayForMethod,
  disputeKey,
} from "@/lib/payments/dispute-gateways";
import {
  applyCouponUsageForOrder,
  reverseCouponUsageForOrder,
} from "@/lib/catalog/coupons";
import { PaymentTransaction } from "@/models/payment-transaction.model";
import {
  DISPATCHED_ORDER_STATUSES,
  getOrderStatusActionByTarget,
  shouldRestoreInventoryForStatusTransition,
} from "@/lib/orders/order-status-workflow";
import {
  buildOrderStatusUpdates,
  buildRollbackUnsets,
  subOrderOverrideFilter,
  subOrderPath,
  subOrderUpdateOptions,
  usesSubOrderArrayFilter,
} from "@/lib/orders/order-status-apply";
import { reconcileOrderStatus } from "@/lib/orders/order-status-reconcile";
import type { StaffPermission } from "@/config/permissions.config";
import { notifyOrderStatus } from "@/lib/notifications/notifications";
import { withApi } from "@/lib/api/handler";
import { afterResponse } from "@/lib/after-response";
import { queueAutoShipForOrder } from "@/lib/shipping/carriers/shipment-worker";
import { getPendingPaymentLock } from "@/lib/orders/pending-payment-lock";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function hasStaffPermission(
  staffPermissions: StaffPermission[] | undefined,
  permission: StaffPermission,
) {
  return !staffPermissions || staffPermissions.includes(permission);
}

/**
 * GET /api/admin/orders/[id]
 * Get a single order by ID
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_ORDERS],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:orders:read",
      "lenient",
      session.user.role
    );

    await connectDB();

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Order");
    const order = await Order.findOne(
      mergeScopeFilter({ _id: id }, buildStaffOrderScopeFilter(access.staffScope)),
    )
      .populate("customerId", "name email phone")
      .lean();

    if (!order) {
      return notFoundResponse("Order");
    }

    // `posLocationId` is a bare string with no `ref`, so the branch cannot be
    // populated and has to be looked up. Without a name this screen says only
    // "POS sale" — true of every counter the merchant runs, and no help at all
    // to somebody tracing a return back to the shelf the units left.
    let posLocationName: string | undefined;
    if (order.posLocationId && isValidObjectId(String(order.posLocationId))) {
      const location = await InventoryLocation.findById(order.posLocationId)
        .select("name")
        .lean<{ name?: string } | null>();
      posLocationName = location?.name;
    }

    return successResponse({ ...order, posLocationName });
  },
);

/**
 * What an order refund is for, as the admin named it: its lines, and how it
 * falls on the sellers.
 *
 * Without it the split can only be averaged across the whole sale, which is
 * right in total and unreadable per line — see `allocateOrderRefund`. Lines
 * are matched by index against the order, and a quantity larger than the line
 * is clamped rather than refused: the split is a description of the money,
 * not a second gate.
 */
function describeOrderRefund(params: {
  order: {
    items?: unknown;
    subOrders?: ReadonlyArray<{ vendorId?: unknown; shippingCost?: number | null } | null> | null;
    tax?: number | null;
    subtotal?: number | null;
  };
  refundItems?: Array<{ orderItemIndex: number; quantity: number }>;
  refundShipping?: number;
  amount: number;
  currency: string;
}): {
  refundedLines: Array<{ orderItemIndex: number; quantity: number }>;
  describedAllocation: RefundAllocationShare[] | null;
} {
  const orderItems = (params.order.items || []) as Array<{
    vendorId?: unknown;
    price?: number;
    quantity?: number;
  }>;
  const refundLines = (params.refundItems || [])
    .map((line) => {
      const item = orderItems[line.orderItemIndex];
      if (!item) return null;
      return {
        orderItemIndex: Number(line.orderItemIndex),
        vendorId: item.vendorId,
        price: Number(item.price || 0),
        quantity: Math.min(
          Math.max(0, Number(line.quantity || 0)),
          Math.max(0, Number(item.quantity || 0)),
        ),
      };
    })
    .filter(Boolean) as Array<{
    orderItemIndex: number;
    vendorId: unknown;
    price: number;
    quantity: number;
  }>;

  // The same lines, kept on the refund row as a fact about WHAT was paid
  // back rather than only how it fell on the sellers.
  //
  // A return claims its quantity from other returns and from nothing else,
  // so an item refunded here could be returned afterwards and refunded a
  // second time: the order's own ceiling is the order TOTAL, which a
  // part-refunded order is nowhere near. `planReturnRequest` reads these
  // units and stops offering them. Only a row that still stands counts —
  // a refund the gateway later failed is marked `failed`, and its units
  // become returnable again, which is exactly right.
  const refundedLines = refundLines
    .filter((line) => line.quantity > 0)
    .map((line) => ({
      orderItemIndex: line.orderItemIndex,
      quantity: line.quantity,
    }));

  // What each parcel's delivery CHARGED the shopper, not what it was rated
  // at: a parcel a free-shipping coupon covered took no delivery money,
  // and weighted by its rate it was handed part of a delivery refund —
  // which the books then moved to the other seller, and the payout did
  // not. Rated only where the order recorded no per-parcel coupon slice.
  const ratedShippingByVendor = new Map<string, number>();
  for (const sub of params.order.subOrders || []) {
    if (!sub?.vendorId) continue;
    const rated = Math.max(0, Number(sub.shippingCost || 0));
    const couponSlice =
      typeof (sub as { shippingDiscount?: number }).shippingDiscount === "number"
        ? Math.max(0, Number((sub as { shippingDiscount?: number }).shippingDiscount))
        : 0;
    ratedShippingByVendor.set(String(sub.vendorId), Math.max(0, rated - couponSlice));
  }

  const describedAllocation =
    refundLines.length > 0 || Number(params.refundShipping || 0) > 0
      ? allocateOrderRefund({
          amount: params.amount,
          currency: params.currency,
          lines: refundLines,
          shipping: params.refundShipping,
          orderTax: params.order.tax,
          orderSubtotal: params.order.subtotal,
          shippingByVendor: ratedShippingByVendor,
        })
      : null;
  return { refundedLines, describedAllocation };
}

/**
 * PUT /api/admin/orders/[id]
 * Update order status
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  // Set once a gateway has sent refund money, cleared once its row is
  // written: anything that fails in between is a refund that happened and was
  // not recorded, which is not the same failure as one that never happened.
  let refundSentAtGateway: Omit<
    Parameters<typeof settleRefundRecordedLate>[0],
    "error"
  > | null = null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [
        STAFF_PERMISSIONS.EDIT_ORDERS,
        STAFF_PERMISSIONS.MANAGE_ORDERS,
        STAFF_PERMISSIONS.DELETE_ORDERS,
      ],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:orders:update",
      "moderate",
      session.user.role
    );

    await connectDB();

    const { id } = await params;
    if (!isValidObjectId(id)) return notFoundResponse("Order");

    const body = await validateBody(request, AdminUpdateOrderSchema);
    const isRefundRequest =
      body.refundAmount !== undefined ||
      body.paymentStatus === PAYMENT_STATUS.REFUNDED ||
      body.paymentStatus === PAYMENT_STATUS.PARTIALLY_REFUNDED;
    if (isRefundRequest && !canIssueRefunds(session.user)) {
      throw new AuthorizationError("Only admins can process refunds");
    }

    const canEditOrder =
      hasStaffPermission(access.staffPermissions, STAFF_PERMISSIONS.EDIT_ORDERS) ||
      hasStaffPermission(access.staffPermissions, STAFF_PERMISSIONS.MANAGE_ORDERS);
    const canCancelOrder =
      hasStaffPermission(access.staffPermissions, STAFF_PERMISSIONS.DELETE_ORDERS) ||
      hasStaffPermission(access.staffPermissions, STAFF_PERMISSIONS.MANAGE_ORDERS);

    const allowedUpdates = [
      "status",
      "paymentStatus",
      "notes",
      "trackingNumber",
      "carrier",
      "cancelReason",
    ] as const;
    const updates: Record<string, unknown> = {};
    type Body = typeof body;
    for (const key of allowedUpdates) {
      const k = key as keyof Body;
      if (body[k] !== undefined) {
        updates[key] = body[k] as unknown;
      }
    }

    const before = await Order.findOne(
      mergeScopeFilter({ _id: id }, buildStaffOrderScopeFilter(access.staffScope)),
    ).lean();
    if (!before) return notFoundResponse("Order");

    // Held while a mobile-money payment is still in flight: cancelling and
    // restocking one, or marking it paid, is how a store ends up owing money
    // it cannot send back automatically. Notes, tracking and the carrier are
    // left alone — they move nothing. See `lib/orders/pending-payment-lock.ts`.
    const pendingPaymentLock = getPendingPaymentLock(before);
    if (
      pendingPaymentLock &&
      (body.status !== undefined ||
        body.paymentStatus !== undefined ||
        body.refundAmount !== undefined)
    ) {
      throw new ValidationError(pendingPaymentLock);
    }

    const isCancelTransition = body.status === ORDER_STATUS.CANCELLED;
    const hasNonCancelStatusUpdate = Boolean(body.status && !isCancelTransition);
    const hasNonStatusUpdate = Boolean(
      body.paymentStatus !== undefined ||
        body.notes !== undefined ||
        body.trackingNumber !== undefined ||
        body.carrier !== undefined ||
        (body.cancelReason !== undefined && !isCancelTransition) ||
        body.refundAmount !== undefined ||
        body.refundReason !== undefined,
    );

    if (isCancelTransition && !canCancelOrder) {
      throw new AuthorizationError("You do not have permission to cancel orders");
    }
    // Cancelling a paid order now sends the money back, so it is a refund as
    // well as a status change — the rule the pre-order screen already keeps.
    if (
      isCancelTransition &&
      getPreorderCollectedAmount(before) > 0 &&
      !canIssueRefunds(session.user)
    ) {
      throw new AuthorizationError(
        "Only an admin can cancel an order that has been paid, because the money has to be refunded",
      );
    }
    if ((hasNonCancelStatusUpdate || hasNonStatusUpdate) && !canEditOrder) {
      throw new AuthorizationError("You do not have permission to edit orders");
    }

    // A vendor's own staff act for the vendor, and the vendor can do neither
    // of these. A payment written here says the store received the money —
    // the vendor becomes payable on its word. And everything else here is
    // the whole order's: on a split order it reaches other vendors' parcels.
    if (access.vendorOwned && body.paymentStatus !== undefined) {
      throw new AuthorizationError(
        "A vendor's staff cannot record a payment here. The vendor records cash it collected from its own orders page.",
      );
    }
    assertVendorStaffMayChangeOrder(access, before);

    // A payment status written by hand is a statement that money arrived, and
    // everything downstream believes it: the ledger posts the sale, loyalty is
    // awarded, the vendor becomes payable. It used to accept any value from
    // anyone holding EDIT_ORDERS, so an uncaptured card order could be marked
    // paid and paid out, a pre-order could be marked paid with its balance
    // never collected, and a paid order moved back to pending was settled a
    // second time the next time its gateway's verify URL was loaded.
    if (body.paymentStatus && !isRefundRequest) {
      assertManualPaymentStatusChange({
        order: before,
        next: body.paymentStatus,
        isAdmin: session.user.role === USER_ROLES.ADMIN,
      });
    }

    // The escape hatch from a deliberately one-way workflow. It stays narrow:
    // an admin (never scoped staff, whatever order permissions they hold),
    // always a written reason, and always its own audit action — an override
    // nobody can find afterwards is indistinguishable from the bug it was
    // meant to fix.
    const isOverride = body.override === true;
    const overrideReason = body.overrideReason?.trim() || "";
    if (isOverride) {
      if (session.user.role !== USER_ROLES.ADMIN) {
        throw new AuthorizationError(
          "Only admins can override the order workflow",
        );
      }
      if (!body.status) {
        throw new ValidationError("An override needs a status to move to");
      }
      if (!overrideReason) {
        throw new ValidationError("An override needs a reason");
      }
    }

    const currentStatus = String(before.status);
    // Reinstating a cancelled order is the one override with physical
    // consequences: its stock went back on the shelf and its coupon use was
    // handed back. Both are re-taken below, BEFORE the status moves, so a shop
    // that has since sold the last unit gets a refusal instead of an order
    // promising goods it does not have.
    const isResurrection =
      isOverride &&
      currentStatus === ORDER_STATUS.CANCELLED &&
      body.status !== ORDER_STATUS.CANCELLED;

    if (body.status && !isOverride) {
      const transition = getOrderStatusActionByTarget(currentStatus, body.status);
      if (!transition) {
        throw new ValidationError(
          `Cannot transition order from "${currentStatus}" to "${body.status}". An admin can override this.`,
        );
      }

      // The same payment gate a vendor meets. An order whose card payment never
      // arrived — or that a chargeback has since refunded in full — could still
      // be packed and shipped from here, because only the vendor route asked.
      // An admin who knows better says so with an override.
      if (isFulfillmentTransition(body.status)) {
        const liveSubOrders = (before.subOrders || []).filter(
          (sub: { status?: string }) => sub?.status !== ORDER_STATUS.CANCELLED,
        );
        const blocked = (liveSubOrders.length > 0 ? liveSubOrders : [null])
          .map((sub: unknown) =>
            getFulfillmentPaymentBlock(
              before as Parameters<typeof getFulfillmentPaymentBlock>[0],
              sub as Parameters<typeof getFulfillmentPaymentBlock>[1],
            ),
          )
          .find(Boolean);
        if (blocked) {
          throw new ValidationError(`${blocked} An admin can override this.`);
        }
      }

      // A courier could not deliver to the address. Marking the order shipped
      // by hand would skip the one step that fixes that.
      if (
        (body.status === ORDER_STATUS.SHIPPED || body.status === ORDER_STATUS.DELIVERED) &&
        isAddressHoldOpen(before as Parameters<typeof isAddressHoldOpen>[0])
      ) {
        throw new ValidationError(
          `${ADDRESS_HOLD_SHIPPING_BLOCK} Correct or confirm it first, or an admin can override this.`,
        );
      }
    }

    if (isResurrection) {
      try {
        await reserveCancelledOrderInventory(id);
      } catch (stockError) {
        throw new ValidationError(
          stockError instanceof Error && stockError.message
            ? `Cannot reinstate this order: ${stockError.message}`
            : "Cannot reinstate this order: its items are no longer in stock",
        );
      }
      // Idempotent on the order's own `coupon.usageIncremented` flag, so an
      // order cancelled before its coupon was ever counted stays uncounted.
      await applyCouponUsageForOrder(id).catch((err) =>
        console.error("Failed to reapply coupon usage on reinstatement:", err),
      );
    }

    // Status, timestamps and the sub-order cascade all come from one shared
    // builder so the vendor route and carrier tracking write the same shape.
    Object.assign(
      updates,
      buildOrderStatusUpdates({
        status: body.status,
        changedBy: session.user.id,
        trackingNumber: body.trackingNumber,
        carrier: body.carrier,
      }),
    );

    // An admin setting the order's payment state is speaking for the whole
    // order, so it has to reach the consignments too. Without this the two
    // disagree the moment the backfill has stamped them: the order would read
    // paid while every sub-order still read pending, and the courier would go
    // on collecting COD on a bill the admin had just settled.
    //
    // Only the explicit body value. The refund branch below writes
    // `updates.paymentStatus` as well, and a refund is an order-level event —
    // stamping `refunded` onto consignments would strip a vendor of a payout
    // they are still owed on the part that was not refunded.
    if (body.paymentStatus && !isRefundRequest) {
      updates[subOrderPath("paymentStatus")] = body.paymentStatus;
      if (body.paymentStatus === PAYMENT_STATUS.PAID) {
        updates[subOrderPath("paidAt")] = new Date();
        updates[subOrderPath("paymentCollectedBy")] = session.user.id;
      }
    }

    if (body.cancelReason) {
      updates.cancelReason = body.cancelReason.trim();
    }

    let refundAmount = 0;
    // The part of it given as store credit (R8), and what went back the way
    // the money came: the refund less that credit.
    let creditAmount = 0;
    let gatewayAmount = 0;
    let creditIssued: { refundTransactionId: string; lotId: string } | null = null;
    // Whether the credit is the order's own credit going back (R8).
    let creditRestores = false;
    // Said to the admin when the credit could not be given beside money that
    // had already gone back.
    let creditFailure: string | null = null;
    // A guest's exchange order (R7): the part its return paid can't be kept as
    // credit with no account, so it is owed back by hand.
    let creditByHand = false;
    // What the refund is for — see `describeOrderRefund`.
    let refundedLines: Array<{ orderItemIndex: number; quantity: number }> = [];
    let describedAllocation: RefundAllocationShare[] | null = null;
    // What this order could be refunded, for settling its status once the
    // refund is written — see `settleRefundedPaymentStatus`.
    let refundCeilingForStatus = 0;
    let refundIsFull = false;
    // Everything refundable has gone back, delivery a delivered order keeps
    // aside — full in all but the payment status. See `goodsRefundedAt`.
    let refundCoversGoods = false;
    // The part of a hand refund sellers hold the cash for, when any do.
    let refundOwedBySellers: VendorHeldRefundShare[] = [];
    // Marks the reservation below as a refund still being recorded, so the
    // gateway's own refund webhook waits for this row instead of writing one.
    const refundStamp = new Date();
    let refundGatewayResult:
      | Awaited<ReturnType<typeof refundOrderPayment>>
      | null = null;
    if (
      (body.paymentStatus === PAYMENT_STATUS.REFUNDED ||
        body.paymentStatus === PAYMENT_STATUS.PARTIALLY_REFUNDED) &&
      body.refundAmount === undefined
    ) {
      throw new ValidationError("Refund amount is required to refund an order");
    }

    // A chargeback recorded by hand: the shopper's bank already took the money,
    // so nothing is sent and the row waits for the gateway's dispute instead of
    // for a refund. Refused where no gateway can raise a dispute, and refused
    // twice for one dispute — the second would be the same money again.
    const chargebackGateway =
      body.manualRefundKind === "chargeback"
        ? disputeGatewayForMethod(before.paymentMethod)
        : null;
    const chargebackDisputeId = String(body.chargebackDisputeId || "").trim();
    const recordsMoneyAlreadyGone =
      Boolean(body.manualRefund) || body.manualRefundKind === "chargeback";
    if (body.refundAmount !== undefined && body.manualRefundKind === "chargeback") {
      if (!chargebackGateway) {
        throw new ValidationError(
          "A chargeback can only be recorded on a card, PayPal, Razorpay or Paystack payment",
        );
      }
      const alreadyRecorded = await PaymentTransaction.exists({
        orderId: before._id,
        type: "refund",
        status: "succeeded",
        ...(chargebackDisputeId
          ? {
              $or: [
                { "metadata.dispute.key": disputeKey(chargebackGateway, chargebackDisputeId) },
                { externalId: disputeKey(chargebackGateway, chargebackDisputeId) },
              ],
            }
          : {
              $or: [
                { "metadata.dispute.gateway": chargebackGateway },
                { "metadata.chargebackByHand.gateway": chargebackGateway },
                { "metadata.chargebackReport.gateway": chargebackGateway },
              ],
            }),
      });
      if (alreadyRecorded) {
        throw new ValidationError(
          chargebackDisputeId
            ? "This dispute's chargeback is already recorded on the order"
            : `A ${DISPUTE_GATEWAY_LABEL[chargebackGateway]} chargeback is already recorded on this order. If this is a different one, enter its dispute ID.`,
        );
      }
    }

    if (body.refundAmount !== undefined) {
      const refundSettings = await getSettings();
      // To what the order's currency can hold: a fraction of a yen or a
      // shilling went to the gateway rounded while the books kept it.
      const parsedRefundAmount = quantizeToCurrency(
        Number(body.refundAmount),
        String(
          (before as { currency?: string }).currency ||
            refundSettings.general?.defaultCurrency ||
            "USD",
        ),
      );
      if (!Number.isFinite(parsedRefundAmount) || parsedRefundAmount <= 0) {
        throw new ValidationError("Refund amount must be greater than 0");
      }
      const refundCurrencyCode = String(
        (before as { currency?: string }).currency ||
          refundSettings.general?.defaultCurrency ||
          "USD",
      );

      // The part given as store credit (R8), checked before anything is
      // claimed; the rest goes back the way the money came. The credit an
      // order was paid with goes back first, as credit — unless the admin
      // named the credit themselves. Money already gone back, or taken by a
      // chargeback, was the gateway's.
      const namedCredit = Math.max(0, Number(body.storeCreditAmount || 0));
      const split = splitRefundCreditFirst({
        amount: parsedRefundAmount,
        order: before as Parameters<typeof splitRefundCreditFirst>[0]["order"],
        currency: refundCurrencyCode,
        explicitCredit: namedCredit > 0 ? namedCredit : recordsMoneyAlreadyGone ? 0 : null,
      });
      creditAmount = split.credit;
      creditRestores = split.restored >= split.credit - 0.0001;
      if (creditAmount > 0) {
        if (recordsMoneyAlreadyGone) {
          throw new ValidationError(
            "Money already sent back, or taken by a chargeback, can't also be given as store credit.",
          );
        }
        const { exchangeCreditGoesByHand } = await import("@/lib/returns/return-exchange");
        creditByHand =
          !(namedCredit > 0) &&
          (await exchangeCreditGoesByHand(
            before as Parameters<typeof exchangeCreditGoesByHand>[0],
          ));
        // A seller who took the cash at their own door holds the money the
        // credit would stand for.
        const problem = creditByHand
          ? null
          : await orderStoreCreditRefundProblem(
              before as Parameters<typeof orderStoreCreditRefundProblem>[0],
            );
        if (problem) throw new ValidationError(problem);
      }
      gatewayAmount = quantizeToCurrency(parsedRefundAmount - creditAmount, refundCurrencyCode);

      // Delivery on an order that reached the shopper is not sitting anywhere
      // to be given back: the carrier was paid the day the parcel left. So it
      // comes off the ceiling a refund can reach, and the goods and their tax
      // are what remains. An admin who does mean to absorb the carrier fee
      // says so by naming it in `refundShipping` — that is the override, and
      // it has to be deliberate rather than the side effect of a Full button.
      // The delivery rule this order was sold under, not today's.
      const refundPolicy = resolveOrderReturnPolicy(before, refundSettings);
      // What the order collected, which is its total unless part of it never
      // arrived — see `getOrderRefundCeiling`. Every cap below is held to it.
      const refundCeiling = getOrderRefundCeiling({
        ...before,
        currency: String(
          (before as { currency?: string }).currency ||
            refundSettings.general?.defaultCurrency ||
            "USD",
        ),
      } as Parameters<typeof getOrderRefundCeiling>[0]);
      const ratedShipping = Math.max(0, Number(before.shippingCost || 0));
      const chargedShipping = isFreeShippingCouponType(before.coupon?.type)
        ? Math.max(0, ratedShipping - Math.max(0, Number(before.discount || 0)))
        : ratedShipping;
      const unrefundableDelivery = unrefundableDeliveryFor({
        policy: refundPolicy,
        dispatched:
          before.status === ORDER_STATUS.SHIPPED ||
          before.status === ORDER_STATUS.DELIVERED,
        chargedShipping,
        // A delivery refunded once is not held back a second time.
        alreadyRefunded: await refundedDeliveryTotal(before._id),
      });
      refundCeilingForStatus = refundCeiling;
      // The card, or the wallet, gives back only what it took: on an order
      // paid partly with store credit, that is the rest (R8).
      const gatewayRoom = orderGatewayRefundRoom({
        order: before as Parameters<typeof orderGatewayRefundRoom>[0]["order"],
        collected: refundCeiling,
        currency: refundCurrencyCode,
      });
      if (!recordsMoneyAlreadyGone && gatewayAmount > gatewayRoom + 0.01) {
        throw new ValidationError(
          `Only ${formatAmount(gatewayRoom)} can go back to the original payment — the rest of this order was paid with store credit. Give more of this refund as store credit.`,
        );
      }
      // What this refund may reach, at the currency's own precision — the
      // same `orderRefundRoom` the refund dialog shows. Naming the delivery
      // grows it by the part of the held-back charge named and no further:
      // naming a single cent of it used to lift the delivery check outright.
      const room = orderRefundRoom({
        ceiling: refundCeiling,
        refunded: Math.max(0, Number(before.refundedTotal || 0)),
        heldDelivery: unrefundableDelivery,
        namedDelivery: Math.max(0, Number(body.refundShipping || 0)),
        currency: String(
          (before as { currency?: string }).currency ||
            refundSettings.general?.defaultCurrency ||
            "USD",
        ),
      });
      const reachable = room.goodsLeft;

      if (unrefundableDelivery > 0 && parsedRefundAmount > room.limit + 0.01) {
        throw new ValidationError(
          room.deliveryOverride > 0
            ? `Only ${formatAmount(room.limit)} can be refunded: ${formatAmount(reachable)} on the goods and their tax, and the ${formatAmount(room.deliveryOverride)} of delivery this refund names.`
            : `This order was delivered, so the ${formatAmount(unrefundableDelivery)} delivery charge has already gone to the carrier and is not refundable. ${formatAmount(reachable)} is left on the goods and their tax. To hand the delivery back anyway, say so explicitly in the refund's delivery field.`,
        );
      }
      if (
        before.paymentStatus !== PAYMENT_STATUS.PAID &&
        before.paymentStatus !== PAYMENT_STATUS.PARTIALLY_REFUNDED
      ) {
        throw new ValidationError(
          "Refunds can only be processed for paid orders",
        );
      }

      // Units somebody is already being paid for.
      //
      // The other half of the guard in `planReturnRequest`: that one stops a
      // return being opened for goods this screen refunded, and this one stops
      // this screen refunding goods a return will. Without it the same item
      // was paid for twice in whichever order the two happened, and the only
      // ceiling either hit was the order TOTAL.
      //
      // Refunding everything that is left is deliberately still allowed: it is
      // how an admin ends an order outright, and refusing it here is exactly
      // the trap that once made a full refund impossible while any return was
      // open. It names the open returns' units too, because it pays for them,
      // and those returns close with it (`closeReturnsRefundedByOrder` below).
      //
      // "Everything left" is measured without the delivery a dispatched order
      // keeps back — the Full refund of a delivered order never reached the
      // total, so it was never treated as whole, and the return's goods it
      // paid for were left on the return to be paid for again.
      const namedRefundItems = body.refundItems || [];
      const refundsWholeRemainder =
        room.limit > 0 && parsedRefundAmount >= room.limit - 0.01;
      if (namedRefundItems.length > 0 && !refundsWholeRemainder) {
        const [claimedByReturns, refundedAlready] = await Promise.all([
          openReturnQuantitiesByIndex(before._id),
          refundedQuantitiesByIndex(before._id),
        ]);
        const orderLines = (before.items || []) as Array<{
          name?: string;
          quantity?: number;
        }>;
        for (const line of namedRefundItems) {
          const index = Number(line.orderItemIndex);
          const wanted = Math.max(0, Number(line.quantity || 0));
          if (wanted <= 0) continue;
          const claimed = claimedByReturns.get(index);
          const left =
            Math.max(0, Number(orderLines[index]?.quantity || 0)) -
            (claimed?.quantity || 0) -
            (refundedAlready.get(index) || 0);
          if (wanted <= left) continue;
          const name = orderLines[index]?.name || "This item";
          throw new ValidationError(
            claimed
              ? `"${name}" is on return ${claimed.returnNumber}. Refund it from that return, or refund the whole of what is left on this order.`
              : `"${name}" has already been refunded on this order. ${Math.max(left, 0)} of it is left to refund.`,
          );
        }
      }

      // Money the admin says already went back from the gateway's dashboard —
      // which the gateway's own report has usually booked by the time anyone
      // records it here. Matched to that row rather than written a second time
      // (see `adoptReportedGatewayRefund`), and nothing else is written: the
      // refund, the payment state, the ledger and the points are on the order
      // already. Only for a request that is the refund alone, which is all the
      // refund dialog ever sends; anything more takes the path below.
      const recordsRefundOnly =
        body.status === undefined &&
        body.notes === undefined &&
        body.trackingNumber === undefined &&
        body.carrier === undefined;
      if (
        body.manualRefund &&
        !chargebackGateway &&
        recordsRefundOnly &&
        refundReconciledByWebhook(before.paymentMethod)
      ) {
        const orderLines = (before.items || []) as Array<{ quantity?: number }>;
        const matched = await adoptReportedGatewayRefund({
          orderId: before._id,
          amount: parsedRefundAmount,
          recordedBy: session.user.id,
          note: body.refundReason?.trim() || undefined,
          refundedLines: namedRefundItems
            .map((line) => ({
              orderItemIndex: Number(line.orderItemIndex),
              quantity: Math.min(
                Math.max(0, Number(line.quantity || 0)),
                Math.max(0, Number(orderLines[line.orderItemIndex]?.quantity || 0)),
              ),
            }))
            .filter((line) => line.quantity > 0),
        });
        if (matched) {
          await auditOrderRefunded(createAuditContext(request, session), before, {
            amount: parsedRefundAmount,
            currency:
              (before as { currency?: string }).currency ||
              refundSettings.general?.defaultCurrency,
            reason: body.refundReason,
            gatewayCalled: true,
            full: before.paymentStatus === PAYMENT_STATUS.REFUNDED,
          });
          const current = await Order.findById(before._id)
            .populate("customerId", "name email")
            .lean();
          return successResponse({
            ...current,
            refundMatched: { transactionId: String(matched._id) },
          });
        }
      }

      ({ refundedLines, describedAllocation } = describeOrderRefund({
        order: before as Parameters<typeof describeOrderRefund>[0]["order"],
        refundItems: body.refundItems,
        refundShipping: body.refundShipping,
        amount: parsedRefundAmount,
        currency: refundCurrencyCode,
      }));

      // Collected, not `total`: a consignment nobody paid for at the door is
      // not money there is to hand back, however the order total reads.
      const total = refundCeiling;
      const [refundSummary] = await PaymentTransaction.aggregate([
        {
          $match: {
            orderId: before._id,
            type: "refund",
            status: "succeeded",
          },
        },
        {
          $group: {
            _id: null,
            totalRefunded: { $sum: "$grossAmount" },
          },
        },
      ]);
      const alreadyRefunded = Number(refundSummary?.totalRefunded || 0);

      // Atomically reserve this refund against a denormalized running total so
      // two concurrent refunds (double-click, or an order refund racing a
      // return refund) cannot both pass the cap. The pipeline update reads the
      // live `refundedTotal`, seeding it from the historical aggregate the
      // first time a legacy order is touched. If the guard fails, no row
      // matches and the reservation is rejected before any money moves.
      const refundClaim = await Order.findOneAndUpdate(
        {
          _id: before._id,
          $expr: {
            $lte: [
              {
                $add: [
                  { $ifNull: ["$refundedTotal", alreadyRefunded] },
                  parsedRefundAmount,
                ],
              },
              total + 0.01,
            ],
          },
        },
        [
          {
            $set: {
              refundedTotal: {
                $add: [
                  { $ifNull: ["$refundedTotal", alreadyRefunded] },
                  parsedRefundAmount,
                ],
              },
              refundInFlightAt: refundStamp,
            },
          },
        ],
        { returnDocument: "after" },
      ).lean();
      if (!refundClaim) {
        throw new ValidationError(
          total < Number(before.total || 0) - 0.01
            ? `Refund amount exceeds what this order collected (${formatAmount(total)})`
            : "Refund amount exceeds order total",
        );
      }
      const nextRefunded = Number(
        (refundClaim as { refundedTotal?: number }).refundedTotal ??
          alreadyRefunded + parsedRefundAmount,
      );

      // Call the payment gateway BEFORE persisting the refunded status so a
      // gateway failure leaves the order in its previous state. For COD/POS/
      // manual flows (or when the admin explicitly opts into recording an
      // out-of-band refund), the gateway call is skipped.
      const gatewaySettings = await getSettings();
      try {
        refundGatewayResult =
          gatewayAmount > 0
            ? await refundOrderPayment({
                order: {
                  paymentMethod: before.paymentMethod,
                  channel: before.channel,
                  paymentId: before.paymentId,
                  stripePaymentIntentId: before.stripePaymentIntentId,
                  preorderBalancePaymentIntentId: before.preorderBalancePaymentIntentId,
                  preorderBalancePaypalOrderId: before.preorderBalancePaypalOrderId,
                  paypalCaptureId: before.paypalCaptureId,
                  paypalOrderId: before.paypalOrderId,
                  razorpayPaymentId: before.razorpayPaymentId,
                  paystackTransactionId: before.paystackTransactionId,
                  pesapalConfirmationCode: before.pesapalConfirmationCode,
                  currency:
                    (before as { currency?: string }).currency ||
                    gatewaySettings.general?.defaultCurrency,
                },
                amount: gatewayAmount,
                reason: body.refundReason,
                manual: recordsMoneyAlreadyGone,
                actor: session.user.email || session.user.id,
              })
            : // All of it as store credit: nothing goes back through a gateway.
              { gatewayCalled: false, provider: "store_credit" };
      } catch (gatewayError) {
        // Release the reservation we claimed above so a failed gateway call
        // doesn't permanently consume refund headroom.
        await Order.updateOne(
          { _id: before._id },
          { $inc: { refundedTotal: -parsedRefundAmount } },
        ).catch((rollbackErr) =>
          console.error("Failed to roll back refund reservation:", rollbackErr),
        );
        await Order.updateOne(...releaseRefundInFlightWrite(before._id, refundStamp)).catch(
        logRefundInFlightReleaseError,
      );
        const message =
          gatewayError instanceof Error
            ? gatewayError.message
            : "Refund failed at the payment gateway";
        throw new ValidationError(message);
      }

      // The store credit part (R8), given before the order is written. With
      // nothing sent anywhere, a failure here is an ordinary failed refund;
      // beside money already gone back, only the credit is handed back.
      let refundedAfter = nextRefunded;
      if (creditAmount > 0) {
        try {
          const creditOrder = {
            _id: String(before._id),
            orderNumber: before.orderNumber,
            paymentMethod: before.paymentMethod,
            paymentStatus: before.paymentStatus,
            paymentId: before.paymentId,
            stripePaymentIntentId: before.stripePaymentIntentId,
            paypalCaptureId: before.paypalCaptureId,
            razorpayPaymentId: before.razorpayPaymentId,
            paystackTransactionId: before.paystackTransactionId,
            pesapalConfirmationCode: before.pesapalConfirmationCode,
            subtotal: before.subtotal,
            shippingCost: before.shippingCost,
            tax: before.tax,
            discount: before.discount,
            total: before.total,
            currency: refundCurrencyCode,
            channel: before.channel || "online",
            posLocationId: before.posLocationId ? String(before.posLocationId) : undefined,
            createdAt: before.createdAt,
            customerId: before.customerId,
          };
          // The units it paid for go on one row only: the gateway's, when
          // there is one — see `refundedQuantitiesByIndex`.
          const creditRowMetadata =
            gatewayAmount <= 0 && refundedLines.length > 0 ? { metadata: { refundedLines } } : {};
          if (creditByHand) {
            const { refundExchangeCreditByHand } = await import("@/lib/returns/return-exchange");
            creditIssued = await refundExchangeCreditByHand({
              order: creditOrder,
              amount: creditAmount,
              allocation: describedAllocation,
              wholeAmount: parsedRefundAmount,
              ...creditRowMetadata,
              reason: body.refundReason?.trim() || undefined,
              createdBy: session.user.id,
            });
          } else {
            creditIssued = await refundToStoreCredit({
              order: creditOrder,
              amount: creditAmount,
              allocation: describedAllocation,
              wholeAmount: parsedRefundAmount,
              ...creditRowMetadata,
              source: creditRestores ? "order_refund_restore" : "order_refund",
              reason: body.refundReason?.trim() || undefined,
              createdBy: session.user.id,
            });
          }
        } catch (creditError) {
          if (!(gatewayAmount > 0)) {
            await Order.updateOne(
              { _id: before._id },
              { $inc: { refundedTotal: -parsedRefundAmount } },
            ).catch((rollbackErr) =>
              console.error("Failed to roll back refund reservation:", rollbackErr),
            );
            await Order.updateOne(...releaseRefundInFlightWrite(before._id, refundStamp)).catch(
              logRefundInFlightReleaseError,
            );
            throw creditError;
          }
          console.error("Failed to give an order refund as store credit:", creditError);
          await Order.updateOne(
            { _id: before._id },
            { $inc: { refundedTotal: -creditAmount } },
          ).catch((rollbackErr) =>
            console.error("Failed to roll back refund reservation:", rollbackErr),
          );
          refundedAfter -= creditAmount;
          creditFailure = `${formatAmount(gatewayAmount)} went back to the original payment, but the ${formatAmount(creditAmount)} of store credit could not be given${
            creditError instanceof Error && creditError.message ? `: ${creditError.message}` : ""
          }. Give it again.`;
          creditAmount = 0;
        }
      }

      refundAmount = quantizeToCurrency(gatewayAmount + creditAmount, refundCurrencyCode);
      if (refundGatewayResult.gatewayCalled) {
        refundSentAtGateway = {
          orderId: before._id,
          orderNumber: String(before.orderNumber || ""),
          amount: gatewayAmount,
          currency: (before as { currency?: string }).currency,
          provider: refundGatewayResult.provider,
          externalRefundIds:
            refundGatewayResult.externalRefundIds ||
            (refundGatewayResult.externalRefundId
              ? [refundGatewayResult.externalRefundId]
              : []),
          refundStamp,
        };
      }
      refundIsFull = refundedAfter >= total - 0.01;
      updates.paymentStatus = refundIsFull
        ? PAYMENT_STATUS.REFUNDED
        : PAYMENT_STATUS.PARTIALLY_REFUNDED;
      // The "Full refund" of a delivered order: goods and tax back, delivery
      // kept because the carrier was paid. It stays `partially_refunded` —
      // that is true, and the seller is still owed the delivery — but the sale
      // is over. Measured against the total alone it never was: the restock
      // box was ignored without a word, the coupon stayed spent and digital
      // files stayed open.
      refundCoversGoods =
        refundIsFull ||
        (unrefundableDelivery > 0 &&
          refundedAfter >= total - unrefundableDelivery - 0.01);
      if (refundCoversGoods && !refundIsFull) {
        updates.goodsRefundedAt = new Date();
      }
    }

    // Optimistic-concurrency guard for status transitions: the transition was
    // validated against `before.status`, so require the order to STILL be in
    // that status at write time. Without this, two overlapping updates (e.g.
    // ship + cancel) both validate against the same stale read and the later
    // write regresses a shipped order to cancelled and wrongly restocks it.
    // Skipped when this request also processed a refund — the gateway has
    // already moved money at this point, and losing the refund record would be
    // worse than the (already validated) status write.
    const statusGuard =
      updates.status && refundAmount === 0 ? { status: before.status } : {};

    // An override replaces the protective cascade with one that reaches the
    // consignments it is correcting, and clears the timestamps of a future
    // that no longer happened — see `subOrderOverrideFilter` and
    // `buildRollbackUnsets`.
    const unsets =
      isOverride && body.status ? buildRollbackUnsets(body.status) : {};
    const writeOptions =
      isOverride && usesSubOrderArrayFilter({ ...updates, ...unsets })
        ? { arrayFilters: [subOrderOverrideFilter(isResurrection)] }
        : subOrderUpdateOptions(updates);

    // Sub-order writes use the filtered positional operator so an order-level
    // change never clobbers a sub-order a vendor already cancelled (its status,
    // tracking, and timestamps must survive the parent transition).
    const order = await Order.findOneAndUpdate(
      mergeScopeFilter(
        { _id: id, ...statusGuard },
        buildStaffOrderScopeFilter(access.staffScope),
      ),
      {
        $set: updates,
        ...(Object.keys(unsets).length > 0 ? { $unset: unsets } : {}),
        // Marked paid here: the first money on the order, unless an earlier
        // collection already dated it. The ledger dates the sale by it.
        ...(body.paymentStatus === PAYMENT_STATUS.PAID && !isRefundRequest
          ? { $min: { paidAt: new Date() } }
          : {}),
      },
      {
        returnDocument: "after",
        runValidators: true,
        ...writeOptions,
      }
    )
      .populate("customerId", "name email")
      .lean();

    if (!order) {
      if (updates.status && refundAmount === 0) {
        const stillExists = await Order.exists(
          mergeScopeFilter(
            { _id: id },
            buildStaffOrderScopeFilter(access.staffScope),
          ),
        );
        if (stillExists) {
          throw new ValidationError(
            "Order was updated by someone else. Refresh and try again.",
          );
        }
      }
      return notFoundResponse("Order");
    }

    // Another refund finishing beside this one may have written its own
    // status over this one's; settled from the stored running total.
    if (
      refundAmount > 0 &&
      order.paymentStatus === PAYMENT_STATUS.PARTIALLY_REFUNDED &&
      (await settleRefundedPaymentStatus({
        orderId: order._id,
        ceiling: refundCeilingForStatus,
      }))
    ) {
      order.paymentStatus = PAYMENT_STATUS.REFUNDED;
    }

    // The cascade above spares consignments that have shipped or overtaken the
    // target, so on a split order the write may have landed only in part —
    // cancelling an order in which one vendor already delivered cancels the
    // other vendor and leaves a delivered order behind. Re-derive rather than
    // let the order-level badge claim something its goods never did.
    if (updates.status) {
      const reconciled = await reconcileOrderStatus(order);
      if (reconciled) order.status = reconciled;
    }

    // Cash on delivery is collected AT the delivery, so the order that has
    // just been marked delivered is paid — see `settleCodOnDelivery`, which
    // does nothing unless this really is an unpaid COD order. Ahead of the
    // side effects below because it writes the payment status they read.
    if (order.status === ORDER_STATUS.DELIVERED) {
      const { settleCodOnDelivery } = await import(
        "@/lib/orders/cod-collection"
      );
      if (await settleCodOnDelivery(order._id)) {
        order.paymentStatus = PAYMENT_STATUS.PAID;
      }
    }

    let settingsForSideEffects: Awaited<ReturnType<typeof getSettings>> | null =
      null;
    const getSideEffectSettings = async () => {
      if (!settingsForSideEffects) {
        settingsForSideEffects = await getSettings();
      }
      return settingsForSideEffects;
    };

    // A consignment being marked collected posts that consignment's sale, even
    // while the order as a whole is only part-paid. The charge row below still
    // waits for the whole order — it carries the order total and cannot be
    // apportioned — but ledger entries are keyed and sized per consignment, so
    // there is nothing to wait for. Mirrors the vendor route.
    if (body.paymentStatus === PAYMENT_STATUS.PAID && !isRefundRequest) {
      // The store credit that paid the rest is spent with it (R8) — before the
      // posting, which reads what the credit paid.
      const { settleOrderStoreCredit } = await import("@/lib/store-credit/store-credit");
      await settleOrderStoreCredit(
        order as Parameters<typeof settleOrderStoreCredit>[0],
      ).catch((err) => console.error("Failed to settle an order's store credit:", err));
      const { postOrderPaidSafely } = await import("@/lib/finance/post-events");
      postOrderPaidSafely(order._id);
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

    if (order.paymentStatus === PAYMENT_STATUS.PAID) {
      const settings = await getSideEffectSettings();
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
        currency: order.currency || settings.general?.defaultCurrency,
        channel: order.channel || "online",
        posLocationId: order.posLocationId ? String(order.posLocationId) : undefined,
        createdAt: order.createdAt,
      });
    }

    if (refundAmount > 0) {
      // Optionally restore inventory when the admin opts in. This order-level
      // path restores the ENTIRE order, so only do it for a FULL refund — a
      // partial refund has no item granularity here and would over-restock
      // items the customer still has. Partial restocks must go through the
      // returns flow, which knows exactly which items/quantities came back.
      if (body.restoreInventoryOnRefund && refundCoversGoods) {
        // The one caller that may reclaim delivered goods. A full refund with
        // the restock box ticked is a return in all but name: the admin is
        // stating the items are back, which is precisely the knowledge the
        // default (cancellations must not restock what already shipped) is
        // missing.
        await restoreOrderInventory(id, { includeDispatched: true }).catch((err) =>
          console.error("Failed to restore inventory on refund:", err),
        );
      }

      const settings = await getSideEffectSettings();

      // The part that went back the way the money came. The store credit part
      // was recorded with its credit, above (R8).
      const refundRow =
        gatewayAmount > 0
          ? await createRefundTransaction({
              order: {
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
                currency: order.currency || settings.general?.defaultCurrency,
                channel: order.channel || "online",
                posLocationId: order.posLocationId ? String(order.posLocationId) : undefined,
                createdAt: order.createdAt,
              },
              amount: gatewayAmount,
              reason:
                body.refundReason ||
                (chargebackGateway
                  ? `Chargeback recorded by hand — the shopper's bank took the payment back through ${DISPUTE_GATEWAY_LABEL[chargebackGateway]}`
                  : undefined),
              createdBy: session.user.id,
              externalRefundId: refundGatewayResult?.externalRefundId,
              externalRefundIds: refundGatewayResult?.externalRefundIds,
              gatewayCalled: refundGatewayResult?.gatewayCalled,
              allocation:
                creditAmount > 0
                  ? scaleRefundAllocation(
                      describedAllocation,
                      gatewayAmount,
                      String(order.currency || settings.general?.defaultCurrency || "USD"),
                    )
                  : describedAllocation,
              // A refund recorded by hand for money sent from the gateway's own
              // dashboard: the gateway will report it, and that report is matched
              // to this row instead of becoming a second one.
              awaitingGatewayRefund:
                Boolean(body.manualRefund) &&
                !chargebackGateway &&
                refundReconciledByWebhook(order.paymentMethod),
              // The units this refund covered, and — for a chargeback — whose money
              // it was. Built as one object because the row carries one `metadata`:
              // written as two spreads, whichever came last silently dropped the
              // other, and the lines a return must not offer again are the half that
              // would have gone.
              ...(refundedLines.length > 0 || chargebackGateway
                ? {
                    metadata: {
                      ...(refundedLines.length > 0 ? { refundedLines } : {}),
                      ...(chargebackGateway
                        ? {
                            chargebackByHand: { gateway: chargebackGateway },
                            ...(chargebackDisputeId
                              ? {
                                  dispute: {
                                    gateway: chargebackGateway,
                                    id: chargebackDisputeId,
                                    key: disputeKey(
                                      chargebackGateway,
                                      chargebackDisputeId,
                                    ),
                                  },
                                }
                              : {}),
                          }
                        : {}),
                    },
                  }
                : {}),
              // A chargeback waits for its dispute instead — or, named, is that
              // dispute's money from the start. See `applyGatewayDispute`.
              ...(chargebackGateway
                ? {
                    awaitingGatewayDispute: !chargebackDisputeId,
                    source: "admin-chargeback-manual",
                  }
                : {}),
              // `manualRefund` says the money already went back outside Storify; any
              // other refund no gateway carried is still to be sent. The admin who
              // issued it is the one reading this, so it is listed, not announced.
              ...(recordsMoneyAlreadyGone ? { settlement: "not_required" as const } : {}),
              notifySettlement: false,
            })
          : null;
      // Recorded: whatever fails from here on failed after the books agreed.
      refundSentAtGateway = null;
      await Order.updateOne(...releaseRefundInFlightWrite(order._id, refundStamp)).catch(
        logRefundInFlightReleaseError,
      );

      // Cash a seller took at their own door is theirs to hand back, and the
      // books already post it that way — see `vendorHeldRefundShares`. Marked
      // on the row, so the payments screen says who sends it rather than
      // leaving it on the store's list, and each seller is told what they owe.
      if (
        refundRow &&
        refundGatewayResult?.gatewayCalled === false &&
        !recordsMoneyAlreadyGone
      ) {
        const { getDefaultVendorIds } = await import("@/lib/finance/post-events");
        refundOwedBySellers = vendorHeldRefundShares({
          order,
          allocation: (refundRow as { refundAllocation?: RefundAllocationShare[] })
            .refundAllocation,
          ownVendorIds: await getDefaultVendorIds().catch(() => new Set<string>()),
        });
        if (refundOwedBySellers.length > 0) {
          await PaymentTransaction.updateOne(
            { _id: refundRow._id },
            { $set: { "metadata.settlement.owedBySellers": refundOwedBySellers } },
          ).catch((err) =>
            console.error("Failed to mark who sends a hand refund:", err),
          );
          const { notifyVendorOrderRefundOwed } = await import(
            "@/lib/notifications/notifications"
          );
          for (const share of refundOwedBySellers) {
            await notifyVendorOrderRefundOwed({
              vendorId: share.vendorId,
              orderId: String(order._id),
              orderNumber: order.orderNumber,
              transactionId: String(refundRow._id),
              amount: share.amount,
              currency: String(order.currency || settings.general?.defaultCurrency || ""),
              settings,
            });
          }
        }
      }

      const { reverseOrderLoyaltyPoints } = await import("@/lib/customers/customer");
      await reverseOrderLoyaltyPoints(String(order._id)).catch((err) =>
        console.error("Failed to reverse loyalty points:", err),
      );

      // The shopper hears of the credit: how much, and where to spend it. An
      // order refund tells them nothing else (R8).
      if (creditIssued && creditAmount > 0 && !creditByHand) {
        const { notifyStoreCreditIssued } = await import(
          "@/lib/store-credit/store-credit-notify"
        );
        await notifyStoreCreditIssued({
          customerId: String(before.customerId),
          lotId: creditIssued.lotId,
          amount: creditAmount,
          currency: String(order.currency || settings.general?.defaultCurrency || "USD"),
          reason: creditRestores ? "order_refund_restore" : "order_refund",
        }).catch((err) => console.error("Failed to tell a shopper about store credit:", err));
      }

      // Nothing of the goods is left unrefunded, so an open return has
      // nothing left to be refunded for: this refund paid for it, and it
      // closes with it. Left open, it went on offering its whole value.
      if (refundCoversGoods) {
        await closeReturnsRefundedByOrder({
          orderId: order._id,
          transactionId: refundRow?._id ?? creditIssued?.refundTransactionId,
        }).catch((err) =>
          console.error("Failed to close the returns an order refund paid for:", err),
        );
      }
    }

    // Restore inventory when order is cancelled. The helper claims the
    // restore atomically per sub-order, so abandoned-pending orders (no
    // decrement ever happened) are no-ops, and orders already partly
    // restored by a vendor cancel only restore the remaining sub-orders.
    if (
      body.status &&
      shouldRestoreInventoryForStatusTransition(before.status as string, body.status)
    ) {
      // An override reaches consignments that had already shipped or been
      // delivered, and by now they read `cancelled` — so the restore can no
      // longer tell them from goods still on the shelf. Named from the order as
      // it stood before the write: those goods are with a courier or a
      // customer, and only a return puts them back in stock.
      const dispatchedBefore = (
        (before.subOrders || []) as Array<{ _id?: unknown; status?: string }>
      )
        .filter((sub) =>
          DISPATCHED_ORDER_STATUSES.includes(String(sub.status || "")),
        )
        .map((sub) => sub._id);
      await restoreOrderInventory(id, {
        excludeSubOrderIds: dispatchedBefore,
      }).catch((err) =>
        console.error("Failed to restore inventory on admin cancel:", err),
      );
      await releaseOrderPreorders(id).catch((err) =>
        console.error("Failed to release preorder quota on admin cancel:", err),
      );
      // Labels bought for goods that are staying put. Only ones never handed
      // to the carrier; a parcel already on its way is beyond voiding.
      const { voidLabelsForCancellation } = await import(
        "@/lib/shipping/cancel-labels"
      );
      await voidLabelsForCancellation({ orderId: order._id }).catch((err) =>
        console.error("Failed to void labels on admin cancel:", err),
      );
    }

    // Cancel means refund. An admin cancelling a paid order restocked it and
    // kept the money; only the pre-order screen ever sent anything back. The
    // consignments this write actually cancelled are the ones owed their
    // share — a shipped sibling survives the cascade and keeps its sale.
    //
    // An override included. It is the admin stating that the order did not
    // happen the way the record says — a parcel marked delivered that never
    // arrived — and skipping the refund there left the shopper with neither
    // the goods nor the money.
    let cancellationRefund:
      | Awaited<ReturnType<typeof refundOrderCancellation>>
      | { refunded: false; reason: string }
      | undefined;
    if (isCancelTransition) {
      const wasCancelled = new Set(
        ((before.subOrders || []) as Array<{ _id?: unknown; status?: string }>)
          .filter((sub) => sub.status === ORDER_STATUS.CANCELLED)
          .map((sub) => String(sub._id)),
      );
      cancellationRefund = await refundOrderCancellation({
        orderId: id,
        cancelledSubOrderIds: (
          (order.subOrders || []) as Array<{ _id?: unknown; status?: string }>
        )
          .filter(
            (sub) =>
              sub.status === ORDER_STATUS.CANCELLED &&
              !wasCancelled.has(String(sub._id)),
          )
          .map((sub) => sub._id),
        reason: body.cancelReason?.trim() || "Order cancelled by the store",
        actor: session.user.email || session.user.id,
        createdBy: session.user.id,
        auditContext: createAuditContext(request, session),
      }).catch((err: unknown) => {
        console.error("Failed to refund cancelled order:", err);
        return {
          refunded: false as const,
          failed: true,
          reason: "The refund could not be issued",
        };
      });
    }

    // Reverse coupon usage on cancellation or full refund. Read from the
    // RECONCILED status, not from what was asked for: a cancellation that only
    // took the un-shipped half of a split order leaves goods the customer is
    // keeping, and the discount they used to buy them stands.
    const movedToCancelled =
      order.status === ORDER_STATUS.CANCELLED &&
      before.status !== ORDER_STATUS.CANCELLED;
    const movedToFullyRefunded =
      (updates.paymentStatus === PAYMENT_STATUS.REFUNDED &&
        before.paymentStatus !== PAYMENT_STATUS.REFUNDED) ||
      // Idempotent on the order's own flag, so a second pass releases nothing.
      refundCoversGoods;
    if (movedToCancelled || movedToFullyRefunded) {
      await reverseCouponUsageForOrder(id).catch((err) =>
        console.error("Failed to reverse coupon usage:", err),
      );
    }

    // Send customer notification and matching email if status changed. Keyed
    // by the order rather than its populated customer, which is null on a
    // guest order — the reason guests used to hear nothing from here at all.
    if (body.status) {
      await notifyOrderStatus({
        orderId: String(order._id),
        status: body.status,
      }).catch((err) =>
        console.error("Failed to create order status notification:", err),
      );
    }

    // Kick auto-shipping the moment a merchant moves an order to processing,
    // so they see a label appear rather than waiting for the next sweep. The
    // sweep is still what guarantees it happens — this only makes it prompt.
    if (body.status === ORDER_STATUS.PROCESSING) {
      afterResponse(() => queueAutoShipForOrder(id, session.user.id));
    }

    const auditContext = createAuditContext(request, session);

    // Emit the meaningful events FIRST, so the timeline reads as a story
    // ("Status changed from pending to processing", "Partial refund of 40.00
    // issued") rather than the field-name dump auditUpdate produces.
    if (body.status && body.status !== before.status) {
      if (isOverride) {
        // Its own action, never folded into an ordinary STATUS_CHANGE: the
        // whole point of the hatch is that using it is visible afterwards.
        await auditOrderStatusOverride(auditContext, order, {
          from: currentStatus,
          to: body.status,
          reason: overrideReason,
        });
      } else if (body.status === ORDER_STATUS.CANCELLED) {
        await auditOrderCancelled(auditContext, order, {
          from: String(before.status),
          by: "admin",
          reason: body.cancelReason?.trim() || undefined,
        });
      } else {
        await auditOrderStatus(auditContext, order, {
          from: String(before.status),
          to: body.status,
        });
      }
    }

    if (refundAmount > 0) {
      const settings = await getSideEffectSettings();
      await auditOrderRefunded(auditContext, order, {
        amount: refundAmount,
        currency:
          (before as { currency?: string }).currency ||
          settings.general?.defaultCurrency,
        reason: body.refundReason,
        gatewayCalled: refundGatewayResult?.gatewayCalled,
        full: refundIsFull,
        storeCredit: creditByHand ? 0 : creditAmount,
        ...(chargebackGateway
          ? {
              chargeback: {
                gatewayLabel: DISPUTE_GATEWAY_LABEL[chargebackGateway],
                disputeId: chargebackDisputeId || undefined,
              },
            }
          : {}),
      });
    }

    // Only for the field edits the events above don't already describe
    // (tracking, carrier, notes, mark-as-paid). A pure status transition would
    // otherwise land twice: once as the readable STATUS_CHANGE and once as
    // "Updated order fields: status, cancelledAt, statusChangedBy, ...".
    if (hasNonStatusUpdate) {
      await auditUpdate(
        auditContext,
        "order",
        id,
        (before || {}) as unknown as Record<string, unknown>,
        order as unknown as Record<string, unknown>,
      );
    }

    return successResponse({
      ...order,
      ...(cancellationRefund ? { refund: cancellationRefund } : {}),
      ...(refundOwedBySellers.length > 0 ? { refundOwedBySellers } : {}),
      ...(creditAmount > 0 && !creditByHand ? { storeCreditGiven: creditAmount } : {}),
      ...(creditAmount > 0 && creditByHand ? { refundOwedByHand: creditAmount } : {}),
      ...(creditFailure ? { storeCreditFailed: creditFailure } : {}),
    });
  } catch (error) {
    // The money went and the record did not: said as that, never as a
    // refund that failed — a retry would send it a second time.
    if (refundSentAtGateway) {
      console.error("Refund sent at the gateway but not recorded:", error);
      await settleRefundRecordedLate({ ...refundSentAtGateway, error });
      return successResponse(
        { refundRecordedLate: true },
        "The refund went through, but it could not be recorded here yet. It appears on the order once the payment gateway reports it — do not send it again.",
      );
    }
    return handleApiError(error);
  }
}

/**
 * DELETE /api/admin/orders/[id]
 * Permanently delete an order record.
 *
 * Pre-shipment orders (preordered/pending/processing) get the same
 * compensation as cancellation first — reserved stock back, preorder quota
 * released, coupon usage reversed — because their goods never left.
 * Shipped/delivered orders are record-only deletes (stock stays consumed),
 * and cancelled orders were already compensated when they were cancelled.
 * The order snapshot is kept in the audit log.
 */
const PRE_SHIPMENT_STATUSES: string[] = [
  ORDER_STATUS.PREORDERED,
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PROCESSING,
];

export const DELETE = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.DELETE_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:orders:delete",
      "moderate",
      session.user.role
    );

    await connectDB();

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Order");

    const scopedFilter = mergeScopeFilter(
      { _id: id },
      buildStaffOrderScopeFilter(access.staffScope),
    );
    const before = await Order.findOne(scopedFilter).lean();
    if (!before) return notFoundResponse("Order");

    // An order that took money is a financial record, whatever happened to it
    // since. Deleting one that was paid and not yet shipped kept the shopper's
    // money with no order left to refund it from, and deleting any of them left
    // its charge and refund rows, and the ledger entries behind them, pointing
    // at nothing. Such an order is cancelled — which refunds it — and kept.
    if (getPreorderCollectedAmount(before) > 0) {
      throw new ValidationError(
        "This order has taken payment, so it is kept as a financial record. Cancel it instead — cancelling refunds whatever is still held.",
      );
    }
    // An exchange order holds its return's money even before its own payment
    // comes (R7). Deleted, that money stayed spent on an order that no longer
    // existed; cancelled, it goes back on the return.
    const exchangeOf = (before as { exchangeOf?: { returnNumber?: string; undoneAt?: Date } })
      .exchangeOf;
    if (exchangeOf?.returnNumber && !exchangeOf.undoneAt) {
      throw new ValidationError(
        `This order is the exchange for return ${exchangeOf.returnNumber}. Cancel it instead — cancelling puts the return's money back on the return.`,
      );
    }

    // Compensation must run while the order document still exists: the
    // coupon reversal claims its idempotency flag on the order itself, and
    // inventory/preorder restores are gated by per-sub-order flags.
    if (PRE_SHIPMENT_STATUSES.includes(String(before.status))) {
      await restoreOrderInventory(id).catch((err) =>
        console.error("Failed to restore inventory on admin DELETE:", err),
      );
      await releaseOrderPreorders(id).catch((err) =>
        console.error("Failed to release preorder quota on admin DELETE:", err),
      );
      await reverseCouponUsageForOrder(id).catch((err) =>
        console.error("Failed to reverse coupon usage on admin DELETE:", err),
      );
    }

    const deleted = await Order.findOneAndDelete(scopedFilter);
    if (!deleted) return notFoundResponse("Order");

    const auditContext = createAuditContext(request, session);
    await auditDelete(
      auditContext,
      "order",
      id,
      {
        orderNumber: before.orderNumber,
        status: before.status,
        paymentStatus: before.paymentStatus,
        total: before.total,
        channel: (before as { channel?: string }).channel,
        customerId: String(before.customerId ?? ""),
        createdAt: before.createdAt,
      },
      String(before.orderNumber ?? id),
    );

    return successResponse({ message: "Order deleted successfully" });
  },
);
