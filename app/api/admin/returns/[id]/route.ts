import { connectDB } from "@/lib/db";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { AdminUpdateReturnRequestSchema } from "@/lib/validations";
import { Order, PaymentTransaction, ReturnRequest } from "@/models";
import type {
  ReturnRequestItem,
  ReturnRequestRefundEstimate,
} from "@/models/return-request.model";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { isReturnVisibleToStaff } from "@/lib/returns/return-staff-scope";
import { canIssueRefunds } from "@/lib/access/rbac";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  isReturnDeclineReason,
  NOTHING_REFUNDED_ON_RETURN,
  NOTHING_RESTOCKED_ON_RETURN,
  REFUND_IN_MOTION_STATUSES,
  releasesReturnQuantity,
  RETURN_DECLINE_MESSAGES,
  RETURN_DECLINE_REASON_LABELS,
  returnHasRestocked,
  returnGoodsBack,
  returnMayRestock,
  RETURN_REFUND_STATUS,
  RETURN_STATUS,
  returnStatusAfterCount,
  returnStatusChangeProblem,
  returnStatusForTracking,
} from "@/lib/returns/returns";
import { getSettings } from "@/models/settings.model";
import { PartialRefundError, refundOrderPayment } from "@/lib/orders/order-refund";
import { getOrderRefundCeiling } from "@/lib/orders/preorder-cancel-refund";
import { settleRefundRecordedLate } from "@/lib/orders/refund-recorded-late";
import {
  logRefundInFlightReleaseError,
  releaseRefundInFlightWrite,
} from "@/lib/orders/refund-in-flight";
import {
  adoptReportedGatewayRefund,
  refundReconciledByWebhook,
} from "@/lib/orders/order-refund-sync";
import {
  checkManualSettlement,
  refundSettlesOutOfBand,
  withMaskedRefundAccount,
} from "@/lib/returns/refund-settlement";
import {
  loadPriorReturnUnits,
  priceReturnAsItStands,
  recomputeReturnEstimate,
  refundedDeliveryTotal,
  repriceReturnForReceipt,
} from "@/lib/returns/return-plan";
import {
  assertReturnOverrides,
  changesReturnOverrides,
  mergeReturnOverrides,
} from "@/lib/returns/return-price-overrides";
import {
  assertRestockLocation,
  restockReturnStep,
} from "@/lib/returns/return-restock";
import { orderRefundRoom } from "@/lib/orders/order-refund-room";
import { isFreeShippingCouponType } from "@/lib/catalog/discounts";
import {
  createRefundTransaction,
  ensureChargeTransaction,
} from "@/lib/payments/payment-transactions";
import { quantizeToCurrency } from "@/lib/intl/money";
import { allocateReturnRefund, scaleRefundAllocation } from "@/lib/returns/refund-allocation";
import {
  refundToStoreCredit,
  storeCreditRefundProblem,
} from "@/lib/store-credit/refund-to-credit";
import {
  orderGatewayRefundRoom,
  splitRefundCreditFirst,
  type OrderStoreCredit,
} from "@/lib/store-credit/order-credit";
import {
  resolveReturnFault,
  resolveReturnPolicy,
  unrefundableDeliveryFor,
} from "@/lib/returns/return-policy";
import { notifyReturnRequestCustomer } from "@/lib/notifications/notifications";
import {
  exchangeFreeOnReturn,
  exchangeOverview,
  hasActiveExchange,
  type ExchangePrice,
} from "@/lib/returns/exchange";
import {
  createReturnExchangeOrder,
  exchangeCreditGoesByHand,
  refundExchangeCreditByHand,
} from "@/lib/returns/return-exchange";
import { createAuditContext } from "@/lib/audit";
import {
  auditOrderRefunded,
  auditOrderRefundSettled,
  auditOrderReturn,
} from "@/lib/orders/audit-order";
import { withApi } from "@/lib/api/handler";
import { returnShippingUpdates } from "@/lib/returns/return-destination";
import { markWalkInReturns } from "@/lib/returns/return-walk-in";

function getTimestampUpdate(status?: string) {
  const now = new Date();
  if (status === RETURN_STATUS.APPROVED) return { approvedAt: now };
  if (status === RETURN_STATUS.REJECTED) return { rejectedAt: now };
  if (status === RETURN_STATUS.RECEIVED) return { receivedAt: now };
  if (status === RETURN_STATUS.INSPECTED) return { inspectedAt: now };
  if (status === RETURN_STATUS.REFUNDED) return { refundedAt: now, closedAt: now };
  if (status === RETURN_STATUS.CLOSED) return { closedAt: now };
  if (status === RETURN_STATUS.CANCELLED) return { closedAt: now };
  return {};
}

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
      "admin:returns:read",
      "lenient",
      session.user.role,
    );

    await connectDB();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Return request");

    const returnRequest = await ReturnRequest.findOne({
      _id: id,
    })
      .populate("customerId", "name email phone")
      .populate("ownerVendorId", "storeName")
      .lean();
    // The list's scope, for a return opened by its id: staff limited to a
    // vendor, a location or a region read any return in the shop from here,
    // the shopper's bank or wallet number included.
    if (
      !returnRequest ||
      !(await isReturnVisibleToStaff(returnRequest, {
        scope: access.staffScope,
        vendorOwned: access.vendorOwned,
      }))
    ) {
      return notFoundResponse("Return request");
    }

    // A return on a walk-in POS sale names no customer — see markWalkInReturns.
    const [shown] = await markWalkInReturns([
      access.staffPermissions ? withMaskedRefundAccount(returnRequest) : returnRequest,
    ]);
    return successResponse(shown);
  },
);

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
      "admin:returns:update",
      "moderate",
      session.user.role,
    );

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Return request");
    const body = await validateBody(request, AdminUpdateReturnRequestSchema);

    await connectDB();
    const settings = await getSettings();

    const before = await ReturnRequest.findOne({
      _id: id,
    }).lean();
    if (
      !before ||
      !(await isReturnVisibleToStaff(before, {
        scope: access.staffScope,
        vendorOwned: access.vendorOwned,
      }))
    ) {
      return notFoundResponse("Return request");
    }

    const updates: Record<string, unknown> = {
      updatedBy: session.user.id,
      ...getTimestampUpdate(body.status),
    };
    if (body.status) updates.status = body.status;
    if (body.adminNote !== undefined) updates.adminNote = body.adminNote;
    if (body.rejectionReason !== undefined) {
      updates.rejectionReason = body.rejectionReason;
    }
    // Declining: why, for the store, and a message the shopper is always sent
    // — Shopify requires one too. A reason with words of its own fills the
    // message in; "other" has to be written.
    if (body.status === RETURN_STATUS.REJECTED) {
      const declineReason = isReturnDeclineReason(body.declineReason)
        ? body.declineReason
        : "other";
      const message =
        String(body.rejectionReason ?? "").trim() || RETURN_DECLINE_MESSAGES[declineReason];
      if (!message) {
        throw new ValidationError(
          "Write the message the shopper is sent: why this return can't be accepted.",
        );
      }
      updates.declineReason = declineReason;
      updates.rejectionReason = message;
    }
    if (body.carrier !== undefined) updates["shipment.carrier"] = body.carrier;
    if (body.trackingNumber !== undefined) {
      updates["shipment.trackingNumber"] = body.trackingNumber;
      // In transit while the parcel is still on its way. Recorded after it
      // arrived — or after the refund — the return stays where it is.
      const tracked = returnStatusForTracking(before.status);
      if (tracked) updates.status = tracked;
      updates["shipment.trackingAddedBy"] = "staff";
      updates["shipment.trackingAddedAt"] = new Date();
    }

    // How the parcel comes back and where to, decided as the return is
    // approved or changed afterwards — see `returnShippingUpdates`.
    Object.assign(
      updates,
      await returnShippingUpdates({ before, body, settings }),
    );

    // Set when less came back than the shopper has already been paid for, so
    // the notice below can say so once everything else has been written.
    let shortReceipt: { refunded: number; worth: number } | null = null;

    // What this return is priced on top of: the units returned or refunded
    // before it was made (see `loadPriorReturnUnits`). Read once, and only by
    // a request that re-prices it.
    let priorUnits: Map<number, number> | null = null;
    const loadPriorUnits = async () => {
      priorUnits ??= await loadPriorReturnUnits({
        orderId: before.orderId,
        before: (before as { createdAt?: Date }).createdAt,
        excludeReturnId: before._id,
      });
      return priorUnits;
    };

    // The fees and delivery the store set by hand — this request's changes on
    // top of what the return already had (`mergeReturnOverrides`). Every
    // re-pricing below carries them, so a count never puts a waived fee back.
    const overridesChanging = changesReturnOverrides(body);

    // Processing the return into its exchange order (R7): a refund whose money
    // pays for that order instead of going back. On its own, so the return is
    // priced exactly as the exchange dialog showed it.
    let exchangePlan: { price: ExchangePrice; credit: number } | null = null;
    if (body.processExchange) {
      if (!canIssueRefunds(session.user)) {
        throw new AuthorizationError("Only admins can exchange a return");
      }
      if (
        body.refundAmount !== undefined ||
        body.storeCreditAmount !== undefined ||
        body.manualRefund ||
        body.settlement ||
        body.status !== undefined ||
        body.approvedItems ||
        body.receivedItems ||
        body.faultOverride ||
        overridesChanging
      ) {
        throw new ValidationError("Process the exchange on its own, then make any other change.");
      }
      const exchangeFrom = await Order.findById(before.orderId)
        .select("currency customs subtotal discount tax coupon paymentStatus")
        .lean();
      if (!exchangeFrom) throw new ValidationError("Order not found for this return");
      const overview = exchangeOverview({
        returnRequest: before as Parameters<typeof exchangeOverview>[0]["returnRequest"],
        order: exchangeFrom as Parameters<typeof exchangeOverview>[0]["order"],
        storeCurrency: settings.general?.defaultCurrency || "USD",
        fallbackTaxPercent: Number(settings.orders?.taxRate || 0) * 100,
      });
      if (overview.problem) throw new ValidationError(overview.problem);
      exchangePlan = { price: overview.price, credit: overview.split.credit };
    }

    if (overridesChanging && !canIssueRefunds(session.user)) {
      throw new AuthorizationError(
        "Only admins can change a return's fees or its delivery refund",
      );
    }
    const overrides = mergeReturnOverrides(before, body);

    // Agreeing to take back less than was asked for.
    //
    // `quantityApproved` was stamped with the requested figure when the return
    // was created and nothing could ever move it, so a store willing to take
    // one of two back had to reject the whole request. It is the figure the
    // refund is priced from, so changing it re-prices the return — and it is
    // refused once money has moved, for the same reason a reclassification is:
    // the estimate is the cap, and dropping it under a refund already sent
    // leaves a return that reads as over-refunded.
    if (body.approvedItems) {
      if (Number(before.actualRefund?.amount || 0) > 0) {
        throw new ValidationError(
          "This return has already been refunded, so what was approved can no longer be changed",
        );
      }
      const items = (before.items as ReturnRequestItem[]).map((item) => {
        const approved = body.approvedItems?.find(
          (entry) => entry.orderItemIndex === item.orderItemIndex,
        );
        if (!approved) return item;
        // Never more than the shopper asked to send back.
        const quantityApproved = Math.min(
          Number(item.quantityRequested || 0),
          Math.max(0, Number(approved.quantityApproved || 0)),
        );
        return {
          ...item,
          quantityApproved,
          // A count already recorded says no more than is now agreed.
          quantityReceived: Math.min(
            Number(item.quantityReceived || 0),
            quantityApproved,
          ),
        };
      });
      updates.items = items;

      const approvalOrder = await Order.findById(before.orderId).lean();
      if (!approvalOrder) throw new ValidationError("Order not found for this return");
      const prior = await loadPriorUnits();
      // Once the parcel has been counted, what arrived is what it is worth.
      // Priced from the approval alone, re-sending it after a short count
      // put the whole value back on the cap.
      updates.estimatedRefund =
        (before.itemsCountedAt
          ? repriceReturnForReceipt({
              items,
              reason: before.reason,
              faultOverride: before.faultOverride,
              order: approvalOrder,
              settings,
              countedBefore: true,
              policyApplied: before.policyApplied,
              priorUnitsByIndex: prior,
              overrides,
            })
          : null) ??
        recomputeReturnEstimate({
          items,
          order: approvalOrder,
          settings,
          merchantAtFault: resolveReturnFault(before),
          policyApplied: before.policyApplied,
          priorUnitsByIndex: prior,
          overrides,
        });
    }

    if (body.receivedItems) {
      const items = ((updates.items ?? before.items) as ReturnRequestItem[]).map((item) => {
        const received = body.receivedItems?.find(
          (entry) => entry.orderItemIndex === item.orderItemIndex,
        );
        if (!received) return item;
        return {
          ...item,
          quantityReceived: Math.min(
            Number(item.quantityApproved ?? item.quantityRequested ?? 0),
            Number(received.quantityReceived || 0),
          ),
          condition: received.condition || item.condition,
        };
      });
      updates.items = items;
      updates.receivedAt = new Date();
      updates.itemsCountedAt = new Date();
      updates.status = body.status || returnStatusAfterCount(before.status);

      // The estimate caps the refund, so it follows what actually came back.
      const receiptOrder = await Order.findById(before.orderId).lean();
      if (receiptOrder) {
        const repriced = repriceReturnForReceipt({
          items,
          reason: before.reason,
          faultOverride: before.faultOverride,
          order: receiptOrder,
          settings,
          countedBefore: Boolean(before.itemsCountedAt),
          policyApplied: before.policyApplied,
          priorUnitsByIndex: await loadPriorUnits(),
          overrides,
        });
        // Never underneath money already sent. A store that refunds on
        // approval and counts the parcel afterwards would otherwise drop its
        // own cap below what it paid: the return would read as over-refunded,
        // and the figures nobody could reconcile would be the books'. The
        // count is still recorded — it is what happened — and the shortfall is
        // announced instead, because the shop is owed that money back and
        // silently re-pricing never told anyone.
        const alreadyRefunded = Number(before.actualRefund?.amount || 0);
        if (repriced && repriced.total < alreadyRefunded - 0.01) {
          shortReceipt = { refunded: alreadyRefunded, worth: repriced.total };
          // And no further than what was sent: left at the pre-count figure,
          // the rest of a parcel that never arrived could still be refunded.
          updates.estimatedRefund = { ...repriced, total: alreadyRefunded };
        } else if (repriced) {
          updates.estimatedRefund = repriced;
        }
      }
    }

    // Nothing will be refunded on a return that is not going ahead — left on
    // `pending`, a cancelled return read as a refund still to come.
    if (
      body.status === RETURN_STATUS.REJECTED ||
      body.status === RETURN_STATUS.CANCELLED
    ) {
      updates.refundStatus = RETURN_REFUND_STATUS.NOT_REQUIRED;
    }
    // Closed is finished without sending more — the return the order's own
    // refund paid for. Not while this return's refund is on its way, which
    // closing would bury; and one that never sent anything is owed nothing
    // through it, so it stops reading as a refund still to come.
    if (body.status === RETURN_STATUS.CLOSED && before.status !== RETURN_STATUS.CLOSED) {
      if (
        REFUND_IN_MOTION_STATUSES.includes(
          String(before.refundStatus || "") as (typeof REFUND_IN_MOTION_STATUSES)[number],
        )
      ) {
        throw new ValidationError(
          "This return's refund is still on its way. Close it once that refund has settled.",
        );
      }
      if (!(Number(before.actualRefund?.amount || 0) > 0) && body.refundAmount === undefined) {
        updates.refundStatus = RETURN_REFUND_STATUS.NOT_REQUIRED;
      }
    }

    // Checked before anything else happens, so a refused move never restocks
    // or refunds on the way.
    const statusProblem = returnStatusChangeProblem({
      from: before.status,
      to: updates.status as string | undefined,
      refundedAmount: before.actualRefund?.amount,
      restocked: returnHasRestocked(before),
      refundingNow: body.refundAmount !== undefined || Boolean(exchangePlan),
    });
    if (statusProblem) throw new ValidationError(statusProblem);

    // Where a restock in this request puts the goods — one of the owner's own
    // locations — checked before any money moves. Refused after the refund,
    // the refund stood and the stock stayed where it was.
    const restockLocationId = body.restoreInventoryOnRefund
      ? await assertRestockLocation(before, body.restockLocationId)
      : null;

    // A payment record sent with the refund it records is checked before any
    // money moves. Checked afterwards, a refund through a gateway went out,
    // the check then refused the request, and the return was never written:
    // no status, no link to the refund for a failure to reopen it by.
    if (body.settlement && body.refundAmount !== undefined) {
      if (!canIssueRefunds(session.user)) {
        throw new AuthorizationError("Only admins can record refund payments");
      }
      const settlingOrder = await Order.findById(before.orderId)
        .select("paymentMethod channel stripePaymentIntentId")
        .lean<{
          paymentMethod?: string;
          channel?: string;
          stripePaymentIntentId?: string;
        } | null>();
      if (
        !body.manualRefund &&
        (!settlingOrder || !refundSettlesOutOfBand(settlingOrder))
      ) {
        throw new ValidationError(
          "This refund goes back through the payment provider, so there is no manual payment to record",
        );
      }
    }

    // Recording what the merchant found on inspection, and re-pricing the
    // return from it.
    //
    // The shopper's reason decided the delivery refund and both fees, which
    // meant the person choosing from a dropdown before anyone had opened the
    // parcel was setting the money. Someone who picks "damaged" on a change of
    // mind collected a delivery refund; a real defect written under "other"
    // silently lost one. This is the only way to correct either.
    if (body.faultOverride) {
      if (!canIssueRefunds(session.user)) {
        throw new AuthorizationError(
          "Only admins can change what a return is down to",
        );
      }
      // Refuse once money has moved: the estimate is what caps a refund, so
      // re-pricing underneath one already issued could put the cap below what
      // was paid. Correct the classification BEFORE refunding, or issue the
      // difference as a separate refund.
      if (Number(before.actualRefund?.amount || 0) > 0) {
        throw new ValidationError(
          "This return has already been refunded, so its value can no longer be recalculated",
        );
      }

      const order = await Order.findById(before.orderId).lean();
      if (!order) throw new ValidationError("Order not found for this return");

      updates.faultOverride = {
        merchantAtFault: body.faultOverride.merchantAtFault,
        note: body.faultOverride.note,
        setBy: session.user.id,
        setAt: new Date(),
      };
      // Priced on what came back once the parcel has been opened, the same
      // as recording the receipt does.
      const faultItems = (updates.items ?? before.items ?? []) as ReturnRequestItem[];
      const received = Boolean(updates.itemsCountedAt || before.itemsCountedAt);
      const prior = await loadPriorUnits();
      updates.estimatedRefund =
        (received
          ? repriceReturnForReceipt({
              items: faultItems,
              faultOverride: {
                merchantAtFault: body.faultOverride.merchantAtFault,
              },
              order,
              settings,
              policyApplied: before.policyApplied,
              priorUnitsByIndex: prior,
              overrides,
            })
          : null) ??
        recomputeReturnEstimate({
          items: faultItems,
          order,
          settings,
          merchantAtFault: body.faultOverride.merchantAtFault,
          policyApplied: before.policyApplied,
          priorUnitsByIndex: prior,
          overrides,
        });
    }

    // Fees lowered or waived, or delivery named, by hand (R5a, R5d). Checked
    // against the policy and the parcel before anything is written, and never
    // priced under money already sent: a fee put back up after a refund would
    // leave the return reading as over-refunded.
    if (overridesChanging) {
      const overrideOrder = await Order.findById(before.orderId).lean();
      if (!overrideOrder) throw new ValidationError("Order not found for this return");
      const asItStands = {
        ...before,
        items: (updates.items ?? before.items) as ReturnRequestItem[],
        itemsCountedAt: (updates.itemsCountedAt ?? before.itemsCountedAt) as
          | Date
          | undefined,
        faultOverride: (updates.faultOverride ?? before.faultOverride) as
          | { merchantAtFault?: boolean }
          | undefined,
      };
      const prior = await loadPriorUnits();
      await assertReturnOverrides({
        returnRequest: asItStands,
        order: overrideOrder,
        settings,
        priorUnitsByIndex: prior,
        body,
        overrides,
      });
      // Re-priced with them, unless a count or approval above already was.
      const repriced =
        (updates.estimatedRefund as ReturnRequestRefundEstimate | undefined) ??
        priceReturnAsItStands({
          returnRequest: asItStands,
          order: overrideOrder,
          settings,
          priorUnitsByIndex: prior,
          overrides,
        });
      const alreadyRefunded = Number(before.actualRefund?.amount || 0);
      if (repriced.total < alreadyRefunded - 0.01) {
        throw new ValidationError(
          `This return has already been refunded ${alreadyRefunded.toFixed(2)}, so it can't be priced below that.`,
        );
      }
      updates.estimatedRefund = repriced;
      if (body.feeOverride !== undefined) {
        updates.feeOverride = overrides.feeOverride
          ? { ...overrides.feeOverride, setBy: session.user.id, setAt: new Date() }
          : null;
      }
      if (body.deliveryRefund !== undefined) {
        updates.deliveryOverride = overrides.deliveryOverride
          ? {
              amount: overrides.deliveryOverride.amount,
              setBy: session.user.id,
              setAt: new Date(),
            }
          : null;
      }
    }

    // What this return is worth as of THIS request. A reclassification in the
    // same call has already re-priced it, and `before` still holds the figure
    // from before that — so the refund cap and the ledger allocation below must
    // read the new one or they would price the refund against a fault the
    // merchant has just corrected.
    const effectiveEstimate = (updates.estimatedRefund ??
      before.estimatedRefund) as ReturnRequestRefundEstimate | undefined;

    let refundAmount = 0;
    // The part of it given as store credit (R8), and that credit's refund row.
    let creditAmount = 0;
    let creditIssued: { refundTransactionId: string; lotId: string } | null = null;
    // Whether the credit is the order's own credit going back.
    let creditRestores = false;
    let refundTxnId: string | undefined;
    let refundCurrency: string | undefined;
    let gatewayResult:
      | Awaited<ReturnType<typeof refundOrderPayment>>
      | null = null;
    // The order's refund stamp, held until the return is linked to the refund
    // row: a failure reported before that could find the row but not the
    // return, reversed the money and left the return reading refunded.
    let heldRefundStamp: { orderId: unknown; stamp: Date } | null = null;
    // Set when a refund split over two charges went through only in part.
    let partialRefundFailure: string | null = null;
    // A guest's exchange order (R7): the part its return paid can't be kept as
    // credit with no account, so it is owed back by hand.
    let creditByHand = false;
    // The exchange order this request made (R7).
    let exchangeMade: Awaited<ReturnType<typeof createReturnExchangeOrder>> | null = null;

    if (body.refundAmount !== undefined || exchangePlan) {
      if (!canIssueRefunds(session.user)) {
        throw new AuthorizationError("Only admins can issue refunds");
      }
      // To what the order's currency can hold: a fraction of a franc was sent
      // to the gateway rounded while the books kept the fraction.
      refundAmount = quantizeToCurrency(
        exchangePlan ? exchangePlan.credit : Number(body.refundAmount || 0),
        String(
          effectiveEstimate?.currency || settings.general?.defaultCurrency || "USD",
        ),
      );
      if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
        throw new ValidationError("Refund amount must be greater than 0");
      }
      if (
        before.status === RETURN_STATUS.REJECTED ||
        before.status === RETURN_STATUS.CANCELLED
      ) {
        throw new ValidationError("Rejected or cancelled returns cannot be refunded");
      }
      // The part given as store credit (R8), checked before anything is
      // claimed; the rest goes back the way the money came.
      const refundCurrencyCode = String(
        effectiveEstimate?.currency || settings.general?.defaultCurrency || "USD",
      );
      // The credit the order was paid with goes back first, as credit —
      // unless the admin named the credit themselves (R8).
      const creditOrder = await Order.findById(before.orderId)
        .select("customerId guestEmail storeCredit exchangeOf")
        .lean<{
          customerId?: unknown;
          guestEmail?: string;
          storeCredit?: OrderStoreCredit | null;
          exchangeOf?: { returnId?: unknown } | null;
        } | null>();
      const namedCredit = Math.max(0, Number(body.storeCreditAmount || 0));
      const split = exchangePlan
        ? // All of it pays for the exchange order, a guest's included (R7).
          { credit: refundAmount, gateway: 0, restored: 0 }
        : splitRefundCreditFirst({
            amount: refundAmount,
            order: creditOrder,
            currency: refundCurrencyCode,
            explicitCredit: namedCredit > 0 ? namedCredit : body.manualRefund ? 0 : null,
          });
      creditAmount = split.credit;
      creditRestores = split.restored >= split.credit - 0.0001;
      if (creditAmount > 0 && !exchangePlan) {
        if (body.manualRefund) {
          throw new ValidationError(
            "A refund recorded as already sent can't also be given as store credit.",
          );
        }
        creditByHand = !(namedCredit > 0) && (await exchangeCreditGoesByHand(creditOrder));
        if (!creditByHand) {
          const problem = await storeCreditRefundProblem({
            order: creditOrder || {},
            refundPayer: before.refundPayer,
          });
          if (problem) throw new ValidationError(problem);
        }
      }
      let gatewayAmount = quantizeToCurrency(refundAmount - creditAmount, refundCurrencyCode);

      // A return refund must not exceed the value of what is being returned.
      // Without this cap a $10-item return could be refunded the full order
      // total; the estimate already includes the items' proportional tax and
      // discount adjustments. The cap is CUMULATIVE across repeated partial
      // refunds of the same return (actualRefund.amount holds the running
      // total) — checking only the current call would let several
      // individually-valid partials together exceed the estimate.
      //
      // No estimate is no ceiling, so there is nothing to refund against here:
      // the cap used to be skipped outright, and such a return could be
      // refunded up to the whole order.
      const estimatedTotal = Number(effectiveEstimate?.total || 0);
      if (!(estimatedTotal > 0)) {
        throw new ValidationError(
          "This return has no estimated value to refund against. Use the order refund flow instead.",
        );
      }
      // Claimed on the return before any money moves. The cap was read off
      // `before` and the running total only incremented at the very end, so two
      // refunds sent together both passed on the same read and the return was
      // refunded up to twice its value. Handed back on every failure below
      // until the gateway has actually sent the money.
      const returnClaim = await ReturnRequest.findOneAndUpdate(
        {
          _id: before._id,
          status: { $nin: [RETURN_STATUS.REJECTED, RETURN_STATUS.CANCELLED] },
          $expr: {
            $lte: [
              { $add: [{ $ifNull: ["$actualRefund.amount", 0] }, refundAmount] },
              estimatedTotal + 0.01,
            ],
          },
          // One exchange at a time (R7). The cap alone let two sent together
          // both through whenever the return was worth twice the new order.
          ...(exchangePlan ? exchangeFreeOnReturn() : {}),
        },
        {
          $inc: { "actualRefund.amount": refundAmount },
          ...(exchangePlan ? { $set: { exchangeClaimedAt: new Date() } } : {}),
        },
        { returnDocument: "after" },
      )
        .select("actualRefund.amount")
        .lean<{ actualRefund?: { amount?: number } } | null>();
      if (!returnClaim) {
        if (exchangePlan) {
          const current = await ReturnRequest.findById(before._id)
            .select("exchange exchangeClaimedAt")
            .lean<{ exchange?: { orderId?: unknown; undoneAt?: Date }; exchangeClaimedAt?: Date } | null>();
          if (current && (hasActiveExchange(current) || current.exchangeClaimedAt)) {
            throw new ValidationError(
              "This return is already being exchanged. Reload it to see the exchange order.",
            );
          }
        }
        const previouslyRefunded = Number(before.actualRefund?.amount || 0);
        throw new ValidationError(
          `Refund exceeds this return's estimated value (${estimatedTotal.toFixed(2)}${
            previouslyRefunded > 0
              ? `; ${previouslyRefunded.toFixed(2)} already refunded`
              : ""
          }). Use the order refund flow for larger refunds.`,
        );
      }
      let cumulativeRefunded = Number(
        returnClaim.actualRefund?.amount ?? refundAmount,
      );
      const releaseReturnClaim = () =>
        ReturnRequest.updateOne(
          { _id: before._id },
          {
            $inc: { "actualRefund.amount": -refundAmount },
            ...(exchangePlan ? { $unset: { exchangeClaimedAt: "" } } : {}),
          },
        ).catch((rollbackErr) =>
          console.error("Failed to hand back a return refund claim:", rollbackErr),
        );

      const order = await Order.findById(before.orderId).lean();
      if (!order) {
        await releaseReturnClaim();
        throw new ValidationError("Order not found for this return");
      }
      // Money the admin says already went back from the gateway's dashboard,
      // which the gateway's own report has usually booked on the order by now
      // — as a refund of its own, attached to nothing. Linked to that row
      // rather than written again (see `adoptReportedGatewayRefund`): the
      // order's refunded total, its payment state, the ledger and the points
      // carry it already. It went back through the gateway, so nobody is left
      // to send it.
      const matchedRefund =
        body.manualRefund && refundReconciledByWebhook(order.paymentMethod)
          ? await adoptReportedGatewayRefund({
              orderId: order._id,
              amount: refundAmount,
              recordedBy: session.user.id,
              note: body.refundReason || `Return ${before.returnNumber}`,
            })
          : null;
      if (matchedRefund) {
        refundTxnId = String(matchedRefund._id);
        refundCurrency = order.currency || undefined;
        gatewayResult = {
          gatewayCalled: true,
          provider: String(matchedRefund.provider || order.paymentMethod || "gateway"),
          externalRefundId: matchedRefund.externalId,
        };
      } else {
        // Deliberately still the ORDER-level state, not the consignment's. The
        // refund cap below is `order.total` against order-level refund rows, and
        // tax and discount are not apportioned per consignment — so a
        // `partially_paid` split order has no honest ceiling to refund against.
        // Refusing until the order is whole withholds money that is genuinely
        // owed; inventing an allocation would move the wrong amount. The former
        // is recoverable.
        if (
          order.paymentStatus !== PAYMENT_STATUS.PAID &&
          order.paymentStatus !== PAYMENT_STATUS.PARTIALLY_REFUNDED
        ) {
          await releaseReturnClaim();
          throw new ValidationError(
            order.paymentStatus === PAYMENT_STATUS.PARTIALLY_PAID
              ? "This order is only partly collected. Refunds can be issued once every vendor's payment is recorded."
              : "Refunds can only be issued for paid orders",
          );
        }

        // What the order collected, not its total — see `getOrderRefundCeiling`.
        const total = getOrderRefundCeiling({
          ...order,
          currency: String(
            (order as { currency?: string }).currency ||
              settings.general?.defaultCurrency ||
              "USD",
          ),
        } as Parameters<typeof getOrderRefundCeiling>[0]);
        const [refundSummary] = await PaymentTransaction.aggregate([
          {
            $match: {
              orderId: order._id,
              type: "refund",
              status: "succeeded",
            },
          },
          { $group: { _id: null, totalRefunded: { $sum: "$grossAmount" } } },
        ]);
        const alreadyRefunded = Number(refundSummary?.totalRefunded || 0);

        // The card, or the wallet, gives back only what it took: on an order
        // paid partly with store credit, that is the rest (R8).
        const gatewayRoom = orderGatewayRefundRoom({
          order: order as Parameters<typeof orderGatewayRefundRoom>[0]["order"],
          collected: total,
          currency: refundCurrencyCode,
        });
        if (!body.manualRefund && gatewayAmount > gatewayRoom + 0.01) {
          await releaseReturnClaim();
          throw new ValidationError(
            `Only ${gatewayRoom.toFixed(2)} can go back to the original payment — the rest of this order was paid with store credit. Give more of this refund as store credit.`,
          );
        }

        // Never into the delivery a dispatched order keeps back, unless this
        // return's own estimate hands delivery back. The order's Full refund
        // pays for the goods and stops short of that delivery — and a return
        // still open on the same goods then had exactly that money left to be
        // refunded from, paying for them twice. Measured as the order route
        // and the refund dialog measure it (`orderRefundRoom`).
        const ratedShipping = Math.max(0, Number(order.shippingCost || 0));
        const room = orderRefundRoom({
          ceiling: total,
          refunded: Number(order.refundedTotal ?? alreadyRefunded),
          heldDelivery: unrefundableDeliveryFor({
            policy: resolveReturnPolicy(settings),
            dispatched:
              order.status === ORDER_STATUS.SHIPPED ||
              order.status === ORDER_STATUS.DELIVERED,
            chargedShipping: isFreeShippingCouponType(order.coupon?.type)
              ? Math.max(0, ratedShipping - Math.max(0, Number(order.discount || 0)))
              : ratedShipping,
            alreadyRefunded: await refundedDeliveryTotal(order._id),
          }),
          namedDelivery: Math.max(0, Number(effectiveEstimate?.shipping || 0)),
          currency: String(
            (order as { currency?: string }).currency ||
              settings.general?.defaultCurrency ||
              "USD",
          ),
        });
        // Checked before the sellers' figure below: that one counts the
        // delivery the order keeps back as still theirs to refund, and told
        // the admin a figure this check would then refuse.
        if (refundAmount > room.limit + 0.01) {
          await releaseReturnClaim();
          throw new ValidationError(
            room.limit > 0
              ? `Only ${room.limit.toFixed(2)} is left to refund on this order for this return — earlier refunds already paid for the rest.`
              : "Nothing is left to refund on this order for this return: a refund on the order itself already paid for these goods. Close the return instead.",
          );
        }

        // Never more than this return's sellers still hold for the order. The
        // estimate is priced from the order as it was sold and knows nothing of
        // refunds since — a delivery refunded from the order screen for a late
        // parcel was quoted again here, the shopper was paid it twice, and the
        // books poured the excess onto another seller's goods. Absent when the
        // order cannot be decomposed, and then only the caps below apply.
        const returnVendorIds = new Set(
          ((before.vendorIds as unknown[] | undefined) || []).map(String),
        );
        const returnConsignments = ((order.subOrders || []) as Array<{
          _id?: unknown;
          vendorId?: unknown;
        }>).filter((sub) => returnVendorIds.has(String(sub.vendorId || "")));
        if (returnConsignments.length > 0) {
          const { loadUnreversedConsignmentTotals } = await import(
            "@/lib/finance/post-events"
          );
          const unreversed = await loadUnreversedConsignmentTotals(order._id).catch(
            () => new Map<string, number>(),
          );
          const known = returnConsignments.every((sub) =>
            unreversed.has(String(sub._id)),
          );
          const leftOnSellers = returnConsignments.reduce(
            (sum, sub) => sum + Math.max(0, unreversed.get(String(sub._id)) || 0),
            0,
          );
          if (known && refundAmount > leftOnSellers + 0.01) {
            await releaseReturnClaim();
            throw new ValidationError(
              `Only ${leftOnSellers.toFixed(2)} is left to refund on this seller's part of the order — earlier refunds already covered the rest.`,
            );
          }
        }

        // Atomically reserve this refund against the order's running refund total
        // so a return refund and an order refund (or two return refunds) cannot
        // both pass the cap concurrently. Mirrors the order refund endpoint —
        // stamp included, so the gateway's refund webhook waits for this row.
        // Held to the room above as well, so an order refund landing between
        // the read and this write cannot open the held-back delivery again.
        const refundStamp = new Date();
        const refundClaim = await Order.findOneAndUpdate(
          {
            _id: order._id,
            $expr: {
              $lte: [
                {
                  $add: [
                    { $ifNull: ["$refundedTotal", alreadyRefunded] },
                    refundAmount,
                  ],
                },
                Math.min(total, room.claimCeiling) + 0.01,
              ],
            },
          },
          [
            {
              $set: {
                refundedTotal: {
                  $add: [
                    { $ifNull: ["$refundedTotal", alreadyRefunded] },
                    refundAmount,
                  ],
                },
                refundInFlightAt: refundStamp,
              },
            },
          ],
          { returnDocument: "after" },
        ).lean();
        if (!refundClaim) {
          await releaseReturnClaim();
          throw new ValidationError(
            total < Number(order.total || 0) - 0.01
              ? `Refund amount exceeds what this order collected (${total.toFixed(2)})`
              : "Refund amount exceeds order total",
          );
        }
        // The order's payment state, worked out again from its running refund
        // total once part of a claim is handed back: the write below had
        // already moved it on to (partially) refunded.
        const settlePaymentStatus = () =>
          Order.updateOne({ _id: order._id }, [
            {
              $set: {
                paymentStatus: {
                  $cond: [
                    { $gt: [{ $ifNull: ["$refundedTotal", 0] }, 0.001] },
                    {
                      $cond: [
                        { $gte: [{ $ifNull: ["$refundedTotal", 0] }, total - 0.01] },
                        PAYMENT_STATUS.REFUNDED,
                        PAYMENT_STATUS.PARTIALLY_REFUNDED,
                      ],
                    },
                    PAYMENT_STATUS.PAID,
                  ],
                },
              },
            },
          ]).catch((err) =>
            console.error("Failed to settle an order's payment state after a refund:", err),
          );
        try {
          // All of it as store credit: nothing goes back through a gateway.
          gatewayResult =
            gatewayAmount > 0
              ? await refundOrderPayment({
                  order: {
                    paymentMethod: order.paymentMethod,
                    channel: order.channel,
                    paymentId: order.paymentId,
                    stripePaymentIntentId: order.stripePaymentIntentId,
                    preorderBalancePaymentIntentId: order.preorderBalancePaymentIntentId,
                    preorderBalancePaypalOrderId: order.preorderBalancePaypalOrderId,
                    paypalCaptureId: order.paypalCaptureId,
                    paypalOrderId: order.paypalOrderId,
                    razorpayPaymentId: order.razorpayPaymentId,
                    paystackTransactionId: order.paystackTransactionId,
                    pesapalConfirmationCode: order.pesapalConfirmationCode,
                    currency:
                      (order as { currency?: string }).currency ||
                      settings.general?.defaultCurrency,
                  },
                  amount: gatewayAmount,
                  reason: body.refundReason || `Return ${before.returnNumber}`,
                  manual: Boolean(body.manualRefund),
                  actor: session.user.email || session.user.id,
                })
              : {
                  gatewayCalled: false,
                  provider: exchangePlan ? "exchange" : creditByHand ? "manual" : "store_credit",
                };
        } catch (gatewayError) {
          const partial =
            gatewayError instanceof PartialRefundError &&
            gatewayError.refundedAmount > 0 &&
            gatewayError.refundedAmount < gatewayAmount - 0.001
              ? gatewayError
              : null;
          if (!partial) {
            // Release the reservation on gateway failure.
            await Order.updateOne(
              { _id: order._id },
              { $inc: { refundedTotal: -refundAmount } },
            ).catch((rollbackErr) =>
              console.error("Failed to roll back refund reservation:", rollbackErr),
            );
            await releaseReturnClaim();
            await Order.updateOne(...releaseRefundInFlightWrite(order._id, refundStamp)).catch(
              logRefundInFlightReleaseError,
            );
            throw gatewayError;
          }
          // A refund over two charges went through for the first and not the
          // second. What went stays claimed and is recorded on THIS return
          // below; only the rest is handed back. Released whole, the part
          // already paid was booked on the order with no return attached, and
          // the return had room to pay it a second time.
          const unsent = quantizeToCurrency(
            gatewayAmount - partial.refundedAmount,
            String((order as { currency?: string }).currency || "USD"),
          );
          await Order.updateOne(
            { _id: order._id },
            { $inc: { refundedTotal: -unsent } },
          ).catch((rollbackErr) =>
            console.error("Failed to roll back refund reservation:", rollbackErr),
          );
          await ReturnRequest.updateOne(
            { _id: before._id },
            { $inc: { "actualRefund.amount": -unsent } },
          ).catch((rollbackErr) =>
            console.error("Failed to hand back a return refund claim:", rollbackErr),
          );
          // The store credit part still goes ahead: it never touched the gateway.
          gatewayAmount = partial.refundedAmount;
          refundAmount = quantizeToCurrency(
            gatewayAmount + creditAmount,
            String((order as { currency?: string }).currency || "USD"),
          );
          cumulativeRefunded -= unsent;
          partialRefundFailure = `Only ${partial.refundedAmount} of this refund went through, and it is recorded on this return. The rest failed: ${partial.failure}. Refund the remaining ${unsent} again.`;
          gatewayResult = {
            gatewayCalled: true,
            provider: partial.provider,
            externalRefundId: partial.refundIds[0],
            externalRefundIds: partial.refundIds,
          };
        }

        // Everything from here records money a gateway may already have sent.
        // A failure is not a refund that failed: see the catch below.
        try {
          // Read off the stored running total inside the write, not off this
          // request's own claim: two refunds landing together each worked a
          // status out from theirs, and whichever wrote last won — an order
          // refunded in full could end on "partially refunded".
          const orderAfterRefund = await Order.findByIdAndUpdate(
            order._id,
            [
              {
                $set: {
                  paymentStatus: {
                    $cond: [
                      {
                        $gte: [{ $ifNull: ["$refundedTotal", 0] }, total - 0.01],
                      },
                      PAYMENT_STATUS.REFUNDED,
                      PAYMENT_STATUS.PARTIALLY_REFUNDED,
                    ],
                  },
                },
              },
            ],
            { returnDocument: "after" },
          ).lean();
          if (!orderAfterRefund) throw new ValidationError("Order refund update failed");
          refundCurrency = orderAfterRefund.currency || undefined;

          await ensureChargeTransaction({
            _id: String(orderAfterRefund._id),
            orderNumber: orderAfterRefund.orderNumber,
            paymentMethod: orderAfterRefund.paymentMethod,
            paymentStatus: orderAfterRefund.paymentStatus,
            paymentId: orderAfterRefund.paymentId,
            stripePaymentIntentId: orderAfterRefund.stripePaymentIntentId,
            paypalCaptureId: orderAfterRefund.paypalCaptureId,
            razorpayPaymentId: orderAfterRefund.razorpayPaymentId,
            paystackTransactionId: orderAfterRefund.paystackTransactionId,
            pesapalConfirmationCode: orderAfterRefund.pesapalConfirmationCode,
            subtotal: orderAfterRefund.subtotal,
            shippingCost: orderAfterRefund.shippingCost,
            tax: orderAfterRefund.tax,
            discount: orderAfterRefund.discount,
            total: orderAfterRefund.total,
            paymentFee: orderAfterRefund.paymentFee,
            paymentFeeCurrency: orderAfterRefund.paymentFeeCurrency,
            paymentFeeRate: orderAfterRefund.paymentFeeRate,
            currency: orderAfterRefund.currency || settings.general?.defaultCurrency,
            channel: orderAfterRefund.channel || "online",
            posLocationId: orderAfterRefund.posLocationId
              ? String(orderAfterRefund.posLocationId)
              : undefined,
            createdAt: orderAfterRefund.createdAt,
          });

          // What this refund is made of, recorded with it. A return is scoped to
          // particular items, so its composition is known here and does not have
          // to be guessed downstream — which is what left 2.64 of commission owed
          // on a fully-returned sale, and what spread one vendor's refund across
          // another vendor's payable on a split order. Null when the return has
          // nothing to weight by, and the ledger then prorates as it always did.
          // `commission ÷ subtotal` per consignment — the same ratio the sale used
          // and the ledger reverses by. Only needed to size the refund
          // administration fee, which is zero unless the store charges one.
          const commissionRatioByVendor = new Map<string, number>();
          for (const sub of orderAfterRefund.subOrders || []) {
            const subSubtotal = Number(sub?.subtotal || 0);
            if (!sub?.vendorId || subSubtotal <= 0) continue;
            commissionRatioByVendor.set(
              String(sub.vendorId),
              Number(sub.commission || 0) / subSubtotal,
            );
          }

          const allocation = allocateReturnRefund({
            amount: refundAmount,
            currency:
              (orderAfterRefund as { currency?: string }).currency ||
              settings.general?.defaultCurrency ||
              "USD",
            // The lines as they stand AFTER this request, not before it: a count
            // recorded in the same call has already re-priced the estimate, and
            // splitting the money by the old quantities put one seller's share on
            // another seller's goods.
            items: (updates.items ?? before.items ?? []) as ReturnRequestItem[],
            estimate: effectiveEstimate || {},
            commissionRatioByVendor,
            policy: resolveReturnPolicy(settings),
          });

          // One refund, recorded as two rows when part of it is store credit
          // (R8): the part that went back the way the money came, and the part
          // the shopper now holds as credit — so the ledger books each where
          // it went. Both carry the same split across sellers.
          const refundOrder = {
            _id: String(orderAfterRefund._id),
            orderNumber: orderAfterRefund.orderNumber,
            paymentMethod: orderAfterRefund.paymentMethod,
            paymentStatus: orderAfterRefund.paymentStatus,
            paymentId: orderAfterRefund.paymentId,
            stripePaymentIntentId: orderAfterRefund.stripePaymentIntentId,
            paypalCaptureId: orderAfterRefund.paypalCaptureId,
            razorpayPaymentId: orderAfterRefund.razorpayPaymentId,
            paystackTransactionId: orderAfterRefund.paystackTransactionId,
            pesapalConfirmationCode: orderAfterRefund.pesapalConfirmationCode,
            subtotal: orderAfterRefund.subtotal,
            shippingCost: orderAfterRefund.shippingCost,
            tax: orderAfterRefund.tax,
            discount: orderAfterRefund.discount,
            total: orderAfterRefund.total,
            currency: orderAfterRefund.currency || settings.general?.defaultCurrency,
            channel: orderAfterRefund.channel || "online",
            posLocationId: orderAfterRefund.posLocationId
              ? String(orderAfterRefund.posLocationId)
              : undefined,
            createdAt: orderAfterRefund.createdAt,
          };
          const txn =
            gatewayAmount > 0
              ? await createRefundTransaction({
                  order: refundOrder,
                  amount: gatewayAmount,
                  reason: body.refundReason || `Return ${before.returnNumber}`,
                  createdBy: session.user.id,
                  externalRefundId: gatewayResult.externalRefundId,
                  externalRefundIds: gatewayResult.externalRefundIds,
                  gatewayCalled: gatewayResult.gatewayCalled,
                  allocation:
                    creditAmount > 0
                      ? scaleRefundAllocation(
                          allocation,
                          gatewayAmount,
                          String(refundOrder.currency || "USD"),
                        )
                      : allocation,
                  // Recorded by hand for money sent from the gateway's dashboard: its
                  // report is matched to this row rather than becoming a second one.
                  awaitingGatewayRefund:
                    Boolean(body.manualRefund) &&
                    refundReconciledByWebhook(orderAfterRefund.paymentMethod),
                  // Waiting on the payments screen when the STORE still has to send
                  // it: a Pesapal request Pesapal has yet to approve, or money no
                  // gateway can carry. Recorded there or on this return, either one
                  // settles both. A seller's own refund stays on the return, where
                  // the seller records it.
                  settlement:
                    (gatewayResult.gatewayCalled &&
                      gatewayResult.provider === "pesapal") ||
                    (gatewayResult.gatewayCalled === false &&
                      !body.manualRefund &&
                      String(before.refundPayer || "") !== "vendor")
                      ? "required"
                      : "not_required",
                })
              : null;
          heldRefundStamp = { orderId: order._id, stamp: refundStamp };
          refundTxnId = txn ? String(txn._id) : undefined;

          if (creditAmount > 0) {
            try {
              if (exchangePlan) {
                // The return's money pays for its exchange order (R7).
                exchangeMade = await createReturnExchangeOrder({
                  returnRequest: before,
                  order: orderAfterRefund,
                  refundOrder,
                  price: exchangePlan.price,
                  credit: creditAmount,
                  allocation,
                  wholeAmount: refundAmount,
                  settings,
                  createdBy: session.user.id,
                  audit: createAuditContext(request, session),
                });
                creditIssued = { refundTransactionId: exchangeMade.refundTransactionId, lotId: "" };
              } else if (creditByHand) {
                creditIssued = await refundExchangeCreditByHand({
                  order: refundOrder,
                  amount: creditAmount,
                  allocation,
                  wholeAmount: refundAmount,
                  reason: body.refundReason || `Return ${before.returnNumber}`,
                  createdBy: session.user.id,
                });
              } else {
                creditIssued = await refundToStoreCredit({
                  order: { ...refundOrder, customerId: orderAfterRefund.customerId },
                  amount: creditAmount,
                  allocation,
                  wholeAmount: refundAmount,
                  source: creditRestores ? "order_refund_restore" : "return_refund",
                  returnId: before._id,
                  reason: body.refundReason || `Return ${before.returnNumber}`,
                  createdBy: session.user.id,
                });
              }
              refundTxnId ??= creditIssued.refundTransactionId;
            } catch (creditError) {
              // Nothing else was recorded: handed back whole, below.
              if (!txn) throw creditError;
              // The part that went back the way it came stands; the credit is
              // handed back, so it can simply be given again.
              console.error("Failed to give a return's refund as store credit:", creditError);
              await Order.updateOne(
                { _id: order._id },
                { $inc: { refundedTotal: -creditAmount } },
              ).catch((rollbackErr) =>
                console.error("Failed to roll back refund reservation:", rollbackErr),
              );
              await ReturnRequest.updateOne(
                { _id: before._id },
                { $inc: { "actualRefund.amount": -creditAmount } },
              ).catch((rollbackErr) =>
                console.error("Failed to hand back a return refund claim:", rollbackErr),
              );
              await settlePaymentStatus();
              cumulativeRefunded -= creditAmount;
              partialRefundFailure = [
                partialRefundFailure,
                `${gatewayAmount} went back to the original payment, but the ${creditAmount} of store credit could not be given: ${
                  creditError instanceof Error ? creditError.message : "unknown error"
                }. Give the rest again.`,
              ]
                .filter(Boolean)
                .join(" ");
              refundAmount = gatewayAmount;
              creditAmount = 0;
            }
          }

          const { reverseOrderLoyaltyPoints } = await import("@/lib/customers/customer");
          await reverseOrderLoyaltyPoints(String(orderAfterRefund._id)).catch((err) =>
            console.error("Failed to reverse loyalty points:", err),
          );
        } catch (recordError) {
          if (!gatewayResult?.gatewayCalled) {
            // Nothing moved anywhere: an ordinary failure, every claim handed
            // back so the refund can simply be tried again.
            await Order.updateOne(
              { _id: order._id },
              { $inc: { refundedTotal: -refundAmount } },
            ).catch((rollbackErr) =>
              console.error("Failed to roll back refund reservation:", rollbackErr),
            );
            await releaseReturnClaim();
            await settlePaymentStatus();
            await Order.updateOne(...releaseRefundInFlightWrite(order._id, refundStamp)).catch(
              logRefundInFlightReleaseError,
            );
            throw recordError;
          }
          // The money went and the record did not. Said as that — read as a
          // failed refund, the retry sent it a second time — and handed to the
          // gateway's own report to record; once it has, the admin links it to
          // this return as already refunded.
          console.error("Return refund sent at the gateway but not recorded:", recordError);
          const { recorded } = await settleRefundRecordedLate({
            orderId: order._id,
            orderNumber: String(order.orderNumber || ""),
            // What the gateway sent; any store credit part was never given.
            amount: gatewayAmount,
            currency: (order as { currency?: string }).currency,
            provider: gatewayResult.provider,
            externalRefundIds:
              gatewayResult.externalRefundIds ||
              (gatewayResult.externalRefundId ? [gatewayResult.externalRefundId] : []),
            refundStamp,
            error: recordError,
          });
          if (!recorded) await releaseReturnClaim();
          throw new ValidationError(
            `The refund went through ${gatewayResult.provider}, but it could not be recorded on this return. It appears on the order once ${gatewayResult.provider} reports it — then record it on this return as already refunded. Do not send it again.`,
          );
        }
      }

      updates.status =
        cumulativeRefunded >= Number(effectiveEstimate?.total || 0) - 0.01
          ? RETURN_STATUS.REFUNDED
          : RETURN_STATUS.PARTIALLY_REFUNDED;
      // `manualRefund` says the money already went back outside Storify — a
      // refund made in the gateway's dashboard, cash handed over at the
      // counter — so nobody is left to send it. Read as "no gateway was
      // called", it parked the return on `manual_required` and told the
      // shopper a transfer was on its way to an account they never gave.
      // Only a refund no gateway carried, and that nobody has sent, is owed.
      const alreadySent = Boolean(body.manualRefund);
      // Pesapal only sends the money once it approves the request, and a
      // refusal would otherwise never be seen: the shopper was told they had
      // been refunded the moment the request was made.
      const awaitingProvider =
        gatewayResult.gatewayCalled !== false && gatewayResult.provider === "pesapal";
      updates.refundStatus =
        // All of it as store credit, or paying for the exchange order: done.
        gatewayAmount <= 0 && creditIssued && !creditByHand
          ? RETURN_REFUND_STATUS.SUCCEEDED
          : (gatewayResult.gatewayCalled === false || creditByHand) && !alreadySent
          ? RETURN_REFUND_STATUS.MANUAL_REQUIRED
          : awaitingProvider
            ? RETURN_REFUND_STATUS.PROCESSING
            : RETURN_REFUND_STATUS.SUCCEEDED;
      if (alreadySent && gatewayResult.gatewayCalled === false) {
        updates["actualRefund.settledMethod"] = "already_refunded";
        updates["actualRefund.settledAt"] = new Date();
        updates["actualRefund.settledBy"] = session.user.id;
      }
      updates.refundedAt = new Date();
      updates.closedAt = updates.status === RETURN_STATUS.REFUNDED ? new Date() : undefined;
      // actualRefund.amount holds the RUNNING total for this return; it was
      // incremented by the claim above, before the money moved. Per-refund
      // amounts live in the PaymentTransaction rows.
      updates["actualRefund.paymentTransactionId"] = refundTxnId;
      updates["actualRefund.provider"] = gatewayResult.provider;
      updates["actualRefund.externalRefundId"] = gatewayResult.externalRefundId;
      if (exchangeMade) {
        updates.exchange = {
          orderId: exchangeMade.orderId,
          orderNumber: exchangeMade.orderNumber,
          credit: creditAmount,
          total: exchangeMade.total,
          owed: exchangeMade.owed,
          // What an undo puts back, should the exchange order be called off.
          statusBefore: String(before.status),
          refundTransactionId: exchangeMade.refundTransactionId,
          processedAt: new Date(),
          processedBy: session.user.id,
        };
      }

      // The vendor took this order's money at the door, so the refund is
      // theirs to send — the ledger has always posted it that way, reversing
      // the commission they owe rather than any cash of the store's. Telling
      // them is the half that was missing: the return sat on `manual_required`
      // addressed to an admin who had never held the money.
      if (String(before.refundPayer || "") === "vendor" && !alreadySent) {
        const { notifyVendorRefundOwed } = await import(
          "@/lib/notifications/notifications"
        );
        await notifyVendorRefundOwed({
          returnRequest: { ...before, _id: before._id },
          amount: refundAmount,
          currency:
            refundCurrency ||
            effectiveEstimate?.currency ||
            settings.general?.defaultCurrency ||
            "USD",
          settings,
        }).catch((err) =>
          console.error("Failed to tell a vendor a refund is theirs:", err),
        );
      }
    }

    // Recording that a hand-paid refund has actually been sent.
    //
    // The only thing that moves a return off `manual_required` — which until
    // now was a terminal state meaning "a human owes this shopper money" with
    // no way to ever say the money went. Accepted alongside the refund, or on
    // its own days later when the transfer clears, which is the usual case.
    let settlementRecorded = false;
    if (body.settlement) {
      if (!canIssueRefunds(session.user)) {
        throw new AuthorizationError("Only admins can record refund payments");
      }
      const problem = checkManualSettlement({
        refundingNow: refundAmount,
        alreadyRefunded: Number(before.actualRefund?.amount || 0),
        gatewayCalledNow: gatewayResult?.gatewayCalled,
        refundStatus: before.refundStatus,
      });
      if (problem && refundAmount > 0) {
        // The money has already gone. Everything that could be known about
        // it was checked before it moved (above); refusing now would only
        // leave the refund unrecorded on this return.
        console.warn(
          `Return ${before.returnNumber}: payment record not applied — ${problem}`,
        );
      } else if (problem) {
        throw new ValidationError(problem);
      } else {
        updates["actualRefund.settledMethod"] = body.settlement.method;
        updates["actualRefund.settledReference"] = body.settlement.reference;
        updates["actualRefund.settledAt"] = new Date();
        updates["actualRefund.settledBy"] = session.user.id;
        // The money has moved, which is the one thing `manual_required` could
        // never say on its own.
        updates.refundStatus = RETURN_REFUND_STATUS.SUCCEEDED;
        settlementRecorded = true;
      }
    }

    // Whether this request puts the goods back on the shelf — done once the
    // return itself is written, below, and only once the goods are back,
    // judged on where this request leaves the return (`returnMayRestock`).
    const restocking =
      Boolean(body.restoreInventoryOnRefund) &&
      returnMayRestock(updates.status ?? before.status) &&
      returnGoodsBack({ ...before, ...updates });

    // Rejecting or cancelling holds only while nothing has been refunded, and
    // only while nothing is back on the shelf: either landing between the read
    // above and this write would otherwise be released along with the
    // quantity it paid for or put back.
    //
    // Any other move of the status is re-checked in the write as well. The
    // shopper's own cancel, or another admin's move, landing in between was
    // written over — a cancelled return brought back as "received" after its
    // units had been released. A refund is guarded by its own claims instead,
    // so it is never refused here after the money has gone.
    const releasing = releasesReturnQuantity(updates.status);
    const movesStatus =
      !refundTxnId &&
      updates.status !== undefined &&
      String(updates.status) !== String(before.status);
    const writeFilter: Record<string, unknown> = { _id: id };
    if (releasing) {
      Object.assign(writeFilter, NOTHING_REFUNDED_ON_RETURN, NOTHING_RESTOCKED_ON_RETURN);
    }
    // Re-pricing is refused once money has moved, and that is decided here
    // too — not only on the read, which a refund could overtake.
    if (!refundTxnId && (body.approvedItems || body.faultOverride)) {
      Object.assign(writeFilter, NOTHING_REFUNDED_ON_RETURN);
    }
    // A fee or delivery changed by hand may re-price a return money has
    // already moved on, but never under it — a refund landing since the read
    // included.
    if (!refundTxnId && overridesChanging) {
      writeFilter.$expr = {
        $lte: [
          { $ifNull: ["$actualRefund.amount", 0] },
          Number((updates.estimatedRefund as ReturnRequestRefundEstimate).total || 0) + 0.01,
        ],
      };
    }
    if (movesStatus) writeFilter.status = before.status;

    const writeReturn = (filter: Record<string, unknown>, update: Record<string, unknown>) =>
      ReturnRequest.findOneAndUpdate(filter, update, {
        returnDocument: "after",
        runValidators: true,
      })
        .populate("customerId", "name email phone")
        // As the list reads it: the returns table swaps the row for this
        // response, and without the seller's name it relabelled every
        // seller's return "Vendor" until the page was reloaded.
        .populate("ownerVendorId", "storeName")
        .lean();
    let returnRequest: Awaited<ReturnType<typeof writeReturn>>;
    try {
      const refundRowIds = [
        refundTxnId,
        creditIssued?.refundTransactionId,
      ].filter((rowId, index, all): rowId is string =>
        Boolean(rowId) && all.indexOf(rowId) === index,
      );
      returnRequest = await writeReturn(writeFilter, {
        $set: updates,
        ...(exchangePlan ? { $unset: { exchangeClaimedAt: "" } } : {}),
        ...(refundRowIds.length > 0
          ? { $addToSet: { "actualRefund.paymentTransactionIds": { $each: refundRowIds } } }
          : {}),
        ...(creditIssued && creditAmount > 0 && !creditByHand
          ? {
              $inc: {
                [exchangeMade ? "actualRefund.exchange" : "actualRefund.storeCredit"]:
                  creditAmount,
              },
            }
          : {}),
      });
    } finally {
      // Held until the return is linked to its refund row — see above.
      if (heldRefundStamp) {
        await Order.updateOne(
          ...releaseRefundInFlightWrite(heldRefundStamp.orderId, heldRefundStamp.stamp),
        ).catch(logRefundInFlightReleaseError);
      }
    }

    if (!returnRequest) {
      const current = await ReturnRequest.findById(id)
        .select("status inventoryRestored items.quantityRestocked actualRefund.amount")
        .lean<{
          status?: string;
          inventoryRestored?: boolean;
          items?: Array<{ quantityRestocked?: number }>;
          actualRefund?: { amount?: number };
        } | null>();
      if (!current) return notFoundResponse("Return request");
      if (String(current.status) !== String(before.status)) {
        throw new ValidationError(
          "This return changed while you were working on it. Reload it and try again.",
        );
      }
      if (Number(current.actualRefund?.amount || 0) > 0) {
        throw new ValidationError(
          releasing
            ? "Money has already been refunded on this return, so it can no longer be rejected or cancelled."
            : "Money has already been refunded on this return, so what it is worth can no longer be changed.",
        );
      }
      if (releasing && returnHasRestocked(current)) {
        throw new ValidationError(
          "These items are already back in stock, so this return can no longer be rejected or cancelled.",
        );
      }
      throw new ValidationError(
        "This return changed while you were working on it. Reload it and try again.",
      );
    }

    // Two refunds on one return landing together each set the status from
    // their own claim, and the last to write won: a return paid in full could
    // end on "partially refunded". Settled from the stored running total.
    if (refundTxnId && returnRequest.status === RETURN_STATUS.PARTIALLY_REFUNDED) {
      const whole = await writeReturn(
        {
          _id: id,
          status: RETURN_STATUS.PARTIALLY_REFUNDED,
          $expr: {
            $gte: [
              { $ifNull: ["$actualRefund.amount", 0] },
              { $subtract: [{ $ifNull: ["$estimatedRefund.total", 0] }, 0.01] },
            ],
          },
        },
        { $set: { status: RETURN_STATUS.REFUNDED, closedAt: new Date() } },
      );
      if (whole) returnRequest = whole;
    }

    // Putting back on the shelf what came back in the parcel.
    //
    // Deliberately NOT inside the refund branch it used to live in. The goods
    // are on the shelf the moment they are unpacked, which is rarely the moment
    // the money goes — and a return refunded without the box ticked, or refunded
    // from the order screen, left its stock lost for good with no way to
    // recover it. Whether the shopper has been paid is a separate decision,
    // exactly as it is on the vendor route.
    //
    // Only the RETURNED lines, a step at a time as the parcel arrives, and
    // never more than came back sellable (`restockReturnStep`) — nor on a
    // return the shopper or another admin has just called off.
    const responseExtras: Record<string, unknown> = {};
    if (restocking) {
      const outcome = await restockReturnStep({
        returnRequest: returnRequest as Parameters<
          typeof restockReturnStep
        >[0]["returnRequest"],
        locationId: restockLocationId,
        actor: session.user.id,
      });
      if (outcome.kind === "failed" || outcome.kind === "changed") {
        // Everything else was saved; only the stock did not move, and the
        // restock can simply be tried again.
        responseExtras.restockFailed = true;
      } else if (outcome.kind === "restocked") {
        responseExtras.restockedLines = outcome.lines;
        // As the list shows it: the row is swapped for this response.
        const restocked = await ReturnRequest.findById(id)
          .populate("customerId", "name email phone")
          .populate("ownerVendorId", "storeName")
          .lean();
        if (restocked) returnRequest = restocked;
      }
    }

    // The same refund waits on the payments screen when the store sends it
    // (see the refund row's `settlement`). Recorded here, it is recorded there
    // too, so neither screen goes on listing money that has gone as owed.
    if (settlementRecorded && body.settlement) {
      const rowIds = [
        ...((returnRequest.actualRefund?.paymentTransactionIds as unknown[] | undefined) ||
          []),
        returnRequest.actualRefund?.paymentTransactionId,
      ].filter(Boolean);
      if (rowIds.length > 0) {
        await PaymentTransaction.updateMany(
          {
            _id: { $in: rowIds },
            type: "refund",
            // Only a refund that still stands: one cancelled before it was
            // sent, or failed, is kept among the return's rows but was never
            // paid — stamping it sent recorded money that never moved.
            status: "succeeded",
            "metadata.settlement.required": true,
            "metadata.settlement.settledAt": { $exists: false },
          },
          {
            $set: {
              "metadata.settlement.settledAt": new Date(),
              "metadata.settlement.settledBy": session.user.id,
              "metadata.settlement.method": body.settlement.method,
              ...(body.settlement.reference
                ? { "metadata.settlement.reference": body.settlement.reference }
                : {}),
            },
          },
        ).catch((err) =>
          console.error("Failed to settle a return refund's payment row:", err),
        );
        // And out of the account it was really sent from — see
        // `postRefundSettlementReclass`.
        // Only the rows somebody sends by hand: a gateway's own refund left
        // from the gateway, whatever this record says.
        const handRows = await PaymentTransaction.find({
          _id: { $in: rowIds },
          type: "refund",
          status: "succeeded",
          "metadata.settlement.required": true,
        })
          .select("_id")
          .lean<Array<{ _id: unknown }>>()
          .catch(() => []);
        const { postRefundSettlementReclassSafely } = await import(
          "@/lib/finance/post-events"
        );
        for (const row of handRows) {
          postRefundSettlementReclassSafely({
            refundId: row._id,
            method: body.settlement.method,
          });
        }
      }
    }
    // Less came back than the shopper was paid for. The estimate was left
    // standing (see above), so nothing here is wrong in the books — but
    // somebody has to decide whether to ask for the difference, and until now
    // the only record of it was a quantity in a document nobody reads.
    if (shortReceipt) {
      const { notifyAdminsPaymentAnomaly } = await import(
        "@/lib/notifications/notifications"
      );
      const currency =
        (before.estimatedRefund as ReturnRequestRefundEstimate | undefined)
          ?.currency || settings.general?.defaultCurrency || "USD";
      await notifyAdminsPaymentAnomaly({
        title: "Less came back than was refunded",
        message: `Return ${before.returnNumber} on order #${before.orderNumber} was refunded ${shortReceipt.refunded.toFixed(2)} ${currency}, but what actually arrived is worth ${shortReceipt.worth.toFixed(2)}. The count is recorded and the refund stands; recover the difference from the shopper, or write it off.`,
        dedupeKey: `return-short-receipt:${String(before._id)}`,
        link: `/admin/returns`,
      }).catch((err) =>
        console.error("Failed to report a short return receipt:", err),
      );
    }

    // What the exchange order still needs from the shopper goes out as a pay
    // link, worded as the exchange it is (R7).
    if (exchangeMade) {
      responseExtras.exchangeOrder = {
        _id: exchangeMade.orderId,
        orderNumber: exchangeMade.orderNumber,
        owed: exchangeMade.owed,
      };
      if (exchangeMade.owed > 0) {
        const { sendOrderPaymentFailedEmail } = await import(
          "@/lib/orders/order-payment-failed-email"
        );
        const sent = await sendOrderPaymentFailedEmail({
          orderId: exchangeMade.orderId,
          settings,
        });
        if (!sent) responseExtras.payLinkNotSent = true;
      }
    }

    const statusChanged =
      returnRequest.status && String(returnRequest.status) !== String(before.status);
    const refundStatusChanged =
      returnRequest.refundStatus &&
      String(returnRequest.refundStatus) !== String(before.refundStatus);
    if (statusChanged || refundStatusChanged || body.refundAmount !== undefined || exchangeMade) {
      await notifyReturnRequestCustomer(
        returnRequest,
        String(returnRequest.status),
        settings,
        exchangeMade ? { exchanged: true } : {},
      ).catch((err) =>
        console.error("Failed to create return customer notification:", err),
      );
    }
    // A label added, or the address changed, after the shopper was told how to
    // send it back: they hear again with the new details.
    else if (
      (body.returnMethod !== undefined ||
        body.returnToLocationId !== undefined ||
        body.labelUrl !== undefined) &&
      String(returnRequest.status) !== RETURN_STATUS.REQUESTED
    ) {
      await notifyReturnRequestCustomer(
        returnRequest,
        String(returnRequest.status),
        settings,
        { shippingUpdated: true },
      ).catch((err) =>
        console.error("Failed to tell the shopper how to send a return back:", err),
      );
    }

    // Record against the ORDER, so the return and the refund it produced land
    // in that order's timeline. None of this used to be audited anywhere —
    // including the gateway refund above, which moves real money.
    const auditContext = createAuditContext(request, session);
    const auditedOrder = {
      _id: before.orderId,
      orderNumber: String(before.orderNumber || ""),
    };
    if (statusChanged) {
      await auditOrderReturn(auditContext, auditedOrder, {
        returnNumber: String(before.returnNumber || ""),
        from: String(before.status),
        to: String(returnRequest.status),
        // The store's own reason with what the shopper was told — the order
        // timeline is staff-only.
        reason:
          body.status === RETURN_STATUS.REJECTED
            ? [
                isReturnDeclineReason(updates.declineReason)
                  ? RETURN_DECLINE_REASON_LABELS[updates.declineReason]
                  : null,
                (updates.rejectionReason as string | undefined) || null,
              ]
                .filter(Boolean)
                .join(" — ") || undefined
            : undefined,
      });
    }
    if (settlementRecorded && body.settlement) {
      await auditOrderRefundSettled(auditContext, auditedOrder, {
        amount: Number(returnRequest.actualRefund?.amount || 0),
        currency:
          (returnRequest.estimatedRefund as ReturnRequestRefundEstimate | undefined)
            ?.currency || settings.general?.defaultCurrency,
        method: body.settlement.method,
        reference: body.settlement.reference,
        returnNumber: String(before.returnNumber || "") || undefined,
      });
    }
    if (refundAmount > 0) {
      await auditOrderRefunded(auditContext, auditedOrder, {
        amount: refundAmount,
        currency: refundCurrency || settings.general?.defaultCurrency,
        reason: body.refundReason,
        gatewayCalled: gatewayResult?.gatewayCalled,
        returnNumber: String(before.returnNumber || "") || undefined,
        full: returnRequest.status === RETURN_STATUS.REFUNDED,
        storeCredit: creditIssued && !creditByHand ? creditAmount : 0,
        exchangeOrderNumber: exchangeMade?.orderNumber,
      });
    }

    if (partialRefundFailure) {
      responseExtras.partialRefund = {
        refunded: refundAmount,
        message: partialRefundFailure,
      };
    }

    // The returns table swaps its row for this answer, so it carries the same
    // walk-in label the list does.
    const [responseBody] = await markWalkInReturns([
      { ...returnRequest, ...responseExtras },
    ]);
    return successResponse(
      access.staffPermissions ? withMaskedRefundAccount(responseBody) : responseBody,
    );
  },
);
