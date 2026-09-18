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
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { canIssueRefunds } from "@/lib/access/rbac";
import { allocateOrderRefund } from "@/lib/returns/refund-allocation";
import {
  resolveReturnPolicy,
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
import { refundOrderCancellation } from "@/lib/orders/preorder-cancel-refund";
import {
  logRefundInFlightReleaseError,
  releaseRefundInFlightWrite,
} from "@/lib/orders/refund-in-flight";
import { refundReconciledByWebhook } from "@/lib/orders/order-refund-sync";
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
 * PUT /api/admin/orders/[id]
 * Update order status
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
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
    let refundIsFull = false;
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
      const parsedRefundAmount = Number(body.refundAmount);
      if (!Number.isFinite(parsedRefundAmount) || parsedRefundAmount <= 0) {
        throw new ValidationError("Refund amount must be greater than 0");
      }

      // Delivery on an order that reached the shopper is not sitting anywhere
      // to be given back: the carrier was paid the day the parcel left. So it
      // comes off the ceiling a refund can reach, and the goods and their tax
      // are what remains. An admin who does mean to absorb the carrier fee
      // says so by naming it in `refundShipping` — that is the override, and
      // it has to be deliberate rather than the side effect of a Full button.
      const refundPolicy = resolveReturnPolicy(await getSettings());
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
      });
      const reachable = Math.max(
        0,
        Number(before.total || 0) -
          Math.max(0, Number(before.refundedTotal || 0)) -
          unrefundableDelivery,
      );

      if (
        unrefundableDelivery > 0 &&
        Number(body.refundShipping || 0) <= 0 &&
        parsedRefundAmount > reachable + 0.01
      ) {
        throw new ValidationError(
          `This order was delivered, so the ${formatAmount(unrefundableDelivery)} delivery charge has already gone to the carrier and is not refundable. ${formatAmount(reachable)} is left on the goods and their tax. To hand the delivery back anyway, say so explicitly in the refund's delivery field.`,
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

      const total = Number(before.total || 0);
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
        throw new ValidationError("Refund amount exceeds order total");
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
        refundGatewayResult = await refundOrderPayment({
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
          amount: parsedRefundAmount,
          reason: body.refundReason,
          manual: recordsMoneyAlreadyGone,
          actor: session.user.email || session.user.id,
        });
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

      refundAmount = parsedRefundAmount;
      refundIsFull = nextRefunded >= total - 0.01;
      updates.paymentStatus = refundIsFull
        ? PAYMENT_STATUS.REFUNDED
        : PAYMENT_STATUS.PARTIALLY_REFUNDED;
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

    // The cascade above spares consignments that have shipped or overtaken the
    // target, so on a split order the write may have landed only in part —
    // cancelling an order in which one vendor already delivered cancels the
    // other vendor and leaves a delivered order behind. Re-derive rather than
    // let the order-level badge claim something its goods never did.
    if (updates.status) {
      const reconciled = await reconcileOrderStatus(order);
      if (reconciled) order.status = reconciled;
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
        currency: settings.general?.defaultCurrency,
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
      if (body.restoreInventoryOnRefund && refundIsFull) {
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

      // What the admin said this refund is for. Without it the split can only
      // be averaged across the whole sale, which is right in total and
      // unreadable per line — see `allocateOrderRefund`. Lines are matched by
      // index against the order as it stands, and a quantity larger than the
      // line is clamped rather than refused: the money has already moved, and
      // the split is a description of it, not a second gate.
      const orderItems = (order.items || []) as Array<{
        vendorId?: unknown;
        price?: number;
        quantity?: number;
      }>;
      const refundLines = (body.refundItems || [])
        .map((line) => {
          const item = orderItems[line.orderItemIndex];
          if (!item) return null;
          return {
            vendorId: item.vendorId,
            price: Number(item.price || 0),
            quantity: Math.min(
              Math.max(0, Number(line.quantity || 0)),
              Math.max(0, Number(item.quantity || 0)),
            ),
          };
        })
        .filter(Boolean) as Array<{
        vendorId: unknown;
        price: number;
        quantity: number;
      }>;

      const ratedShippingByVendor = new Map<string, number>();
      for (const sub of order.subOrders || []) {
        if (!sub?.vendorId) continue;
        ratedShippingByVendor.set(
          String(sub.vendorId),
          Math.max(0, Number(sub.shippingCost || 0)),
        );
      }

      const describedAllocation =
        refundLines.length > 0 || Number(body.refundShipping || 0) > 0
          ? allocateOrderRefund({
              amount: refundAmount,
              currency:
                (order as { currency?: string }).currency ||
                settings.general?.defaultCurrency ||
                "USD",
              lines: refundLines,
              shipping: body.refundShipping,
              orderTax: order.tax,
              orderSubtotal: order.subtotal,
              shippingByVendor: ratedShippingByVendor,
            })
          : null;

      await createRefundTransaction({
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
          currency: settings.general?.defaultCurrency,
          channel: order.channel || "online",
          posLocationId: order.posLocationId ? String(order.posLocationId) : undefined,
          createdAt: order.createdAt,
        },
        amount: refundAmount,
        reason:
          body.refundReason ||
          (chargebackGateway
            ? `Chargeback recorded by hand — the shopper's bank took the payment back through ${DISPUTE_GATEWAY_LABEL[chargebackGateway]}`
            : undefined),
        createdBy: session.user.id,
        externalRefundId: refundGatewayResult?.externalRefundId,
        externalRefundIds: refundGatewayResult?.externalRefundIds,
        gatewayCalled: refundGatewayResult?.gatewayCalled,
        allocation: describedAllocation,
        // A refund recorded by hand for money sent from the gateway's own
        // dashboard: the gateway will report it, and that report is matched
        // to this row instead of becoming a second one.
        awaitingGatewayRefund:
          Boolean(body.manualRefund) &&
          !chargebackGateway &&
          refundReconciledByWebhook(order.paymentMethod),
        // A chargeback waits for its dispute instead — or, named, is that
        // dispute's money from the start. See `applyGatewayDispute`.
        ...(chargebackGateway
          ? {
              metadata: {
                chargebackByHand: { gateway: chargebackGateway },
                ...(chargebackDisputeId
                  ? {
                      dispute: {
                        gateway: chargebackGateway,
                        id: chargebackDisputeId,
                        key: disputeKey(chargebackGateway, chargebackDisputeId),
                      },
                    }
                  : {}),
              },
              awaitingGatewayDispute: !chargebackDisputeId,
              source: "admin-chargeback-manual",
            }
          : {}),
        // `manualRefund` says the money already went back outside Storify; any
        // other refund no gateway carried is still to be sent. The admin who
        // issued it is the one reading this, so it is listed, not announced.
        ...(recordsMoneyAlreadyGone ? { settlement: "not_required" as const } : {}),
        notifySettlement: false,
      });
      await Order.updateOne(...releaseRefundInFlightWrite(order._id, refundStamp)).catch(
        logRefundInFlightReleaseError,
      );

      const { reverseOrderLoyaltyPoints } = await import("@/lib/customers/customer");
      await reverseOrderLoyaltyPoints(String(order._id)).catch((err) =>
        console.error("Failed to reverse loyalty points:", err),
      );
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
        return { refunded: false as const, reason: "The refund could not be issued" };
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
      updates.paymentStatus === PAYMENT_STATUS.REFUNDED &&
      before.paymentStatus !== PAYMENT_STATUS.REFUNDED;
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

    return successResponse(
      cancellationRefund ? { ...order, refund: cancellationRefund } : order,
    );
  } catch (error) {
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
