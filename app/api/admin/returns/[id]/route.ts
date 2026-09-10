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
import { PAYMENT_STATUS } from "@/config/app.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { canIssueRefunds } from "@/lib/access/rbac";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { RETURN_REFUND_STATUS, RETURN_STATUS } from "@/lib/returns/returns";
import { getSettings } from "@/models/settings.model";
import { refundOrderPayment } from "@/lib/orders/order-refund";
import { checkManualSettlement } from "@/lib/returns/refund-settlement";
import { recomputeReturnEstimate } from "@/lib/returns/return-plan";
import {
  createRefundTransaction,
  ensureChargeTransaction,
} from "@/lib/payments/payment-transactions";
import { restoreInventory } from "@/lib/inventory/inventory";
import { allocateReturnRefund } from "@/lib/returns/refund-allocation";
import { resolveReturnPolicy } from "@/lib/returns/return-policy";
import { notifyReturnRequestCustomer } from "@/lib/notifications/notifications";
import { createAuditContext } from "@/lib/audit";
import { auditOrderRefunded, auditOrderReturn } from "@/lib/orders/audit-order";
import { withApi } from "@/lib/api/handler";

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
    await assertAdminOrStaffPermissions(
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
    if (!returnRequest) return notFoundResponse("Return request");

    return successResponse(returnRequest);
  },
);

export const PUT = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await assertAdminOrStaffPermissions(
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
    if (!before) return notFoundResponse("Return request");

    const updates: Record<string, unknown> = {
      updatedBy: session.user.id,
      ...getTimestampUpdate(body.status),
    };
    if (body.status) updates.status = body.status;
    if (body.adminNote !== undefined) updates.adminNote = body.adminNote;
    if (body.rejectionReason !== undefined) {
      updates.rejectionReason = body.rejectionReason;
    }
    if (body.carrier !== undefined) updates["shipment.carrier"] = body.carrier;
    if (body.trackingNumber !== undefined) {
      updates["shipment.trackingNumber"] = body.trackingNumber;
      updates.status = RETURN_STATUS.IN_TRANSIT;
    }

    if (body.receivedItems) {
      const items = (before.items as ReturnRequestItem[]).map((item) => {
        const received = body.receivedItems?.find(
          (entry) => entry.orderItemIndex === item.orderItemIndex,
        );
        if (!received) return item;
        return {
          ...item,
          quantityReceived: Math.min(
            Number(item.quantityApproved || item.quantityRequested || 0),
            Number(received.quantityReceived || 0),
          ),
          condition: received.condition || item.condition,
          restockable: received.restockable ?? item.restockable,
        };
      });
      updates.items = items;
      updates.receivedAt = new Date();
      updates.status = body.status || RETURN_STATUS.RECEIVED;
    }

    if (body.status === RETURN_STATUS.REJECTED) {
      updates.refundStatus = RETURN_REFUND_STATUS.NOT_REQUIRED;
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
      updates.estimatedRefund = recomputeReturnEstimate({
        items: (before.items || []) as ReturnRequestItem[],
        order,
        settings,
        merchantAtFault: body.faultOverride.merchantAtFault,
      });
    }

    // What this return is worth as of THIS request. A reclassification in the
    // same call has already re-priced it, and `before` still holds the figure
    // from before that — so the refund cap and the ledger allocation below must
    // read the new one or they would price the refund against a fault the
    // merchant has just corrected.
    const effectiveEstimate = (updates.estimatedRefund ??
      before.estimatedRefund) as ReturnRequestRefundEstimate | undefined;

    let refundAmount = 0;
    let refundTxnId: string | undefined;
    let gatewayResult:
      | Awaited<ReturnType<typeof refundOrderPayment>>
      | null = null;

    if (body.refundAmount !== undefined) {
      if (!canIssueRefunds(session.user)) {
        throw new AuthorizationError("Only admins can issue refunds");
      }
      refundAmount = Number(body.refundAmount || 0);
      if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
        throw new ValidationError("Refund amount must be greater than 0");
      }
      if (
        before.status === RETURN_STATUS.REJECTED ||
        before.status === RETURN_STATUS.CANCELLED
      ) {
        throw new ValidationError("Rejected or cancelled returns cannot be refunded");
      }

      // A return refund must not exceed the value of what is being returned.
      // Without this cap a $10-item return could be refunded the full order
      // total; the estimate already includes the items' proportional tax and
      // discount adjustments. The cap is CUMULATIVE across repeated partial
      // refunds of the same return (actualRefund.amount holds the running
      // total) — checking only the current call would let several
      // individually-valid partials together exceed the estimate.
      const estimatedTotal = Number(effectiveEstimate?.total || 0);
      const previouslyRefunded = Number(before.actualRefund?.amount || 0);
      const cumulativeRefunded = previouslyRefunded + refundAmount;
      if (estimatedTotal > 0 && cumulativeRefunded > estimatedTotal + 0.01) {
        throw new ValidationError(
          `Refund exceeds this return's estimated value (${estimatedTotal.toFixed(2)}${
            previouslyRefunded > 0
              ? `; ${previouslyRefunded.toFixed(2)} already refunded`
              : ""
          }). Use the order refund flow for larger refunds.`,
        );
      }

      const order = await Order.findById(before.orderId).lean();
      if (!order) throw new ValidationError("Order not found for this return");
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
        throw new ValidationError(
          order.paymentStatus === PAYMENT_STATUS.PARTIALLY_PAID
            ? "This order is only partly collected. Refunds can be issued once every vendor's payment is recorded."
            : "Refunds can only be issued for paid orders",
        );
      }

      const total = Number(order.total || 0);
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

      // Atomically reserve this refund against the order's running refund total
      // so a return refund and an order refund (or two return refunds) cannot
      // both pass the cap concurrently. Mirrors the order refund endpoint.
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
                  refundAmount,
                ],
              },
            },
          },
        ],
        { new: true },
      ).lean();
      if (!refundClaim) {
        throw new ValidationError("Refund amount exceeds order total");
      }
      const nextRefunded = Number(
        (refundClaim as { refundedTotal?: number }).refundedTotal ??
          alreadyRefunded + refundAmount,
      );

      try {
        gatewayResult = await refundOrderPayment({
          order: {
            paymentMethod: order.paymentMethod,
            channel: order.channel,
            paymentId: order.paymentId,
            stripePaymentIntentId: order.stripePaymentIntentId,
            preorderBalancePaymentIntentId: order.preorderBalancePaymentIntentId,
            paypalCaptureId: order.paypalCaptureId,
            razorpayPaymentId: order.razorpayPaymentId,
            paystackTransactionId: order.paystackTransactionId,
            pesapalConfirmationCode: order.pesapalConfirmationCode,
            currency:
              (order as { currency?: string }).currency ||
              settings.general?.defaultCurrency,
          },
          amount: refundAmount,
          reason: body.refundReason || `Return ${before.returnNumber}`,
          manual: Boolean(body.manualRefund),
          actor: session.user.email || session.user.id,
        });
      } catch (gatewayError) {
        // Release the reservation on gateway failure.
        await Order.updateOne(
          { _id: order._id },
          { $inc: { refundedTotal: -refundAmount } },
        ).catch((rollbackErr) =>
          console.error("Failed to roll back refund reservation:", rollbackErr),
        );
        throw gatewayError;
      }

      const paymentStatus =
        nextRefunded >= total - 0.01
          ? PAYMENT_STATUS.REFUNDED
          : PAYMENT_STATUS.PARTIALLY_REFUNDED;
      const orderAfterRefund = await Order.findByIdAndUpdate(
        order._id,
        { $set: { paymentStatus } },
        { new: true },
      ).lean();
      if (!orderAfterRefund) throw new ValidationError("Order refund update failed");

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
        currency: settings.general?.defaultCurrency,
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
        items: (before.items || []) as ReturnRequestItem[],
        estimate: effectiveEstimate || {},
        commissionRatioByVendor,
        policy: resolveReturnPolicy(settings),
      });

      const txn = await createRefundTransaction({
        order: {
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
          currency: settings.general?.defaultCurrency,
          channel: orderAfterRefund.channel || "online",
          posLocationId: orderAfterRefund.posLocationId
            ? String(orderAfterRefund.posLocationId)
            : undefined,
          createdAt: orderAfterRefund.createdAt,
        },
        amount: refundAmount,
        reason: body.refundReason || `Return ${before.returnNumber}`,
        createdBy: session.user.id,
        externalRefundId: gatewayResult.externalRefundId,
        externalRefundIds: gatewayResult.externalRefundIds,
        gatewayCalled: gatewayResult.gatewayCalled,
        allocation,
      });
      refundTxnId = txn ? String(txn._id) : undefined;

      const { reverseOrderLoyaltyPoints } = await import("@/lib/customers/customer");
      await reverseOrderLoyaltyPoints(String(orderAfterRefund._id)).catch((err) =>
        console.error("Failed to reverse loyalty points:", err),
      );

      if (body.restoreInventoryOnRefund) {
        // Restore ONLY the returned items/quantities — not the whole order.
        // Guard with an atomic flag so a repeated refund action can't restock
        // the same units twice.
        const claim = await ReturnRequest.findOneAndUpdate(
          { _id: id, inventoryRestored: { $ne: true } },
          { $set: { inventoryRestored: true } },
        ).lean();
        if (claim) {
          const restoreLines = (before.items || [])
            .map((item: ReturnRequestItem) => ({
              productId: String(item.productId || ""),
              variantId: item.variantId ? String(item.variantId) : undefined,
              quantity: Number(item.quantityApproved ?? item.quantityRequested ?? 0),
            }))
            .filter(
              (line: { productId: string; quantity: number }) =>
                line.productId && line.quantity > 0,
            );
          if (restoreLines.length > 0) {
            await restoreInventory(restoreLines).catch((err) =>
              console.error("Failed to restore inventory on return refund:", err),
            );
          }
        }
      }

      updates.status =
        cumulativeRefunded >= Number(effectiveEstimate?.total || 0) - 0.01
          ? RETURN_STATUS.REFUNDED
          : RETURN_STATUS.PARTIALLY_REFUNDED;
      updates.refundStatus =
        gatewayResult.gatewayCalled === false
          ? RETURN_REFUND_STATUS.MANUAL_REQUIRED
          : RETURN_REFUND_STATUS.SUCCEEDED;
      updates.refundedAt = new Date();
      updates.closedAt = updates.status === RETURN_STATUS.REFUNDED ? new Date() : undefined;
      // actualRefund.amount holds the RUNNING total for this return (the
      // cumulative-cap check reads it); per-refund amounts live in the
      // PaymentTransaction rows. $inc (not $set of a precomputed sum) so a
      // concurrent refund of the same return can't lose an increment.
      updates["actualRefund.paymentTransactionId"] = refundTxnId;
      updates["actualRefund.provider"] = gatewayResult.provider;
      updates["actualRefund.externalRefundId"] = gatewayResult.externalRefundId;
    }

    // Recording that a hand-paid refund has actually been sent.
    //
    // The only thing that moves a return off `manual_required` — which until
    // now was a terminal state meaning "a human owes this shopper money" with
    // no way to ever say the money went. Accepted alongside the refund, or on
    // its own days later when the transfer clears, which is the usual case.
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
      if (problem) throw new ValidationError(problem);

      updates["actualRefund.settledMethod"] = body.settlement.method;
      updates["actualRefund.settledReference"] = body.settlement.reference;
      updates["actualRefund.settledAt"] = new Date();
      updates["actualRefund.settledBy"] = session.user.id;
      // The money has moved, which is the one thing `manual_required` could
      // never say on its own.
      updates.refundStatus = RETURN_REFUND_STATUS.SUCCEEDED;
    }

    const returnRequest = await ReturnRequest.findByIdAndUpdate(
      id,
      refundAmount > 0
        ? { $set: updates, $inc: { "actualRefund.amount": refundAmount } }
        : { $set: updates },
      { new: true, runValidators: true },
    )
      .populate("customerId", "name email phone")
      .lean();

    if (!returnRequest) return notFoundResponse("Return request");
    const statusChanged =
      returnRequest.status && String(returnRequest.status) !== String(before.status);
    const refundStatusChanged =
      returnRequest.refundStatus &&
      String(returnRequest.refundStatus) !== String(before.refundStatus);
    if (statusChanged || refundStatusChanged || body.refundAmount !== undefined) {
      await notifyReturnRequestCustomer(
        returnRequest,
        String(returnRequest.status),
        settings,
      ).catch((err) =>
        console.error("Failed to create return customer notification:", err),
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
        reason:
          body.status === RETURN_STATUS.REJECTED
            ? body.rejectionReason || undefined
            : undefined,
      });
    }
    if (refundAmount > 0) {
      await auditOrderRefunded(auditContext, auditedOrder, {
        amount: refundAmount,
        currency: settings.general?.defaultCurrency,
        reason: body.refundReason,
        gatewayCalled: gatewayResult?.gatewayCalled,
        returnNumber: String(before.returnNumber || "") || undefined,
        full: updates.status === RETURN_STATUS.REFUNDED,
      });
    }

    return successResponse(returnRequest);
  },
);
