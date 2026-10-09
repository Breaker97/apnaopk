import { connectDB } from "@/lib/db";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { AdminUpdateReturnRequestSchema } from "@/lib/validations";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { getSettings } from "@/models/settings.model";
import { Order, ReturnRequest } from "@/models";
import {
  loadPriorReturnUnits,
  recomputeReturnEstimate,
  repriceReturnForReceipt,
} from "@/lib/returns/return-plan";
import { mergeReturnOverrides } from "@/lib/returns/return-price-overrides";
import {
  assertRestockLocation,
  restockReturnStep,
} from "@/lib/returns/return-restock";
import { resolveReturnFault } from "@/lib/returns/return-policy";
import type {
  ReturnRequestItem,
  ReturnRequestRefundEstimate,
} from "@/models/return-request.model";
import {
  isReturnDeclineReason,
  NOTHING_REFUNDED_ON_RETURN,
  NOTHING_RESTOCKED_ON_RETURN,
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
  vendorMaySetReturnStatus,
} from "@/lib/returns/returns";
import {
  checkManualSettlement,
  withoutRefundDestinationUnlessPayer,
} from "@/lib/returns/refund-settlement";
import { notifyReturnRequestCustomer } from "@/lib/notifications/notifications";
import { createAuditContext } from "@/lib/audit";
import {
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

/**
 * The returns a seller may see and act on: their own, and a return from
 * before owners were recorded only when it names them alone. Matched on the
 * seller merely being listed, any seller on a split return could read — and
 * move — the others' parcels.
 */
function vendorReturnScope(vendorId: unknown): Record<string, unknown> {
  return {
    $or: [
      { ownerType: "vendor", ownerVendorId: vendorId },
      { ownerType: { $exists: false }, vendorIds: [vendorId] },
    ],
  };
}

async function getVendorAccess(sessionUser: { id: string; role?: string }) {
  const user = sessionUser;
  const canView = await hasVendorPermission(user, VENDOR_PERMISSIONS.VIEW_ORDERS);
  if (!canView && !isAdmin(user)) {
    throw new AuthorizationError("You do not have permission to view returns");
  }
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
  return requireApprovedVendorByUserId(sessionUser.id);
}

export const GET = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:returns:read", preset: "lenient" },
  },
  async ({ params, session }) => {
    const vendor = await getVendorAccess(session.user);
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Return request");

    const returnRequest = await ReturnRequest.findOne({
      _id: id,
      ...vendorReturnScope(vendor._id),
    })
      .populate("customerId", "name email phone")
      .lean();

    if (!returnRequest) return notFoundResponse("Return request");
    // A return on a walk-in POS sale names no customer — see markWalkInReturns.
    const [shown] = await markWalkInReturns([
      withoutRefundDestinationUnlessPayer(returnRequest),
    ]);
    return successResponse(shown);
  },
);

export const PUT = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const user = session.user;
    const canEdit = await hasVendorPermission(user, VENDOR_PERMISSIONS.EDIT_ORDERS);
    const canManage = canEdit
      ? true
      : await hasVendorPermission(user, VENDOR_PERMISSIONS.MANAGE_ORDERS);
    if (!canEdit && !canManage && !isAdmin(user)) {
      throw new AuthorizationError("You do not have permission to update returns");
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:returns:update",
      "moderate",
      session.user.role,
    );

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Return request");
    const body = await validateBody(request, AdminUpdateReturnRequestSchema);

    // Money moves on the admin's authority alone — `canIssueRefunds` in
    // lib/rbac.ts holds the reasoning. This route is structurally vendor-only
    // (it demands a vendor profile below), so a refund never belongs on it and
    // the fields are refused outright rather than quietly dropped: a vendor
    // whose "Issue refund" call returned 200 with no money moving is precisely
    // the failure the guard exists to prevent.
    if (body.refundAmount !== undefined || body.manualRefund !== undefined) {
      throw new AuthorizationError(
        "Only an admin can issue refunds. Approve or reject this return, and the store admin will process the refund.",
      );
    }
    // And not by the back door either. Refusing the refund FIELDS left the
    // STATUS saying it: `refunded` stamps `refundedAt`, closes the return and
    // tells the shopper they have been paid — none of which a vendor can make
    // true, because the money is on the platform's gateway.
    if (body.status && !vendorMaySetReturnStatus(body.status)) {
      throw new AuthorizationError(
        "Only an admin can mark a return refunded. Record what came back, and the store admin will send the money.",
      );
    }
    // Re-pricing the return by saying whose fault it was decides money, and it
    // was silently dropped here — the same failure in a quieter form.
    if (body.faultOverride !== undefined) {
      throw new AuthorizationError(
        "Only an admin can change what a return is down to.",
      );
    }
    // Nor its fees or the delivery it hands back: both are the refund's size.
    if (body.feeOverride !== undefined || body.deliveryRefund !== undefined) {
      throw new AuthorizationError(
        "Only an admin can change a return's fees or its delivery refund.",
      );
    }

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    const vendor = await requireApprovedVendorByUserId(session.user.id);

    const before = await ReturnRequest.findOne({
      _id: id,
      ...vendorReturnScope(vendor._id),
    }).lean();
    if (!before) return notFoundResponse("Return request");

    const updates: Record<string, unknown> = {
      updatedBy: session.user.id,
      ...getTimestampUpdate(body.status),
    };
    // Set when less came back than the shopper has already been paid for.
    let shortReceipt: { refunded: number; worth: number } | null = null;

    // Recording that the money has gone.
    //
    // Theirs to record only when it was theirs to send: on a cash-on-delivery
    // sale the vendor's own van took the notes at the door, so the store is
    // holding nothing to refund and the books post it as the vendor's
    // (`resolveRefundPayer`). On every other order the money sits with the
    // store, and a vendor marking it paid would be closing a refund they
    // cannot make.
    let settlementRecorded = false;
    if (body.settlement !== undefined) {
      if (String(before.refundPayer || "") !== "vendor") {
        throw new AuthorizationError(
          "The store holds this order's money, so the store sends this refund and records it.",
        );
      }
      const problem = checkManualSettlement({
        // A vendor never issues the refund itself, so there is never one being
        // issued in this request — only one issued earlier, to record.
        refundingNow: 0,
        alreadyRefunded: Number(before.actualRefund?.amount || 0),
        refundStatus: before.refundStatus,
      });
      if (problem) throw new ValidationError(problem);

      updates["actualRefund.settledMethod"] = body.settlement.method;
      updates["actualRefund.settledReference"] = body.settlement.reference;
      updates["actualRefund.settledAt"] = new Date();
      updates["actualRefund.settledBy"] = session.user.id;
      updates.refundStatus = RETURN_REFUND_STATUS.SUCCEEDED;
      settlementRecorded = true;
    }

    if (body.status) updates.status = body.status;
    // The seller's note is theirs: written over `adminNote`, it erased
    // whatever the store had recorded on the return.
    if (body.adminNote !== undefined) updates.vendorNote = body.adminNote;
    if (body.rejectionReason !== undefined) {
      updates.rejectionReason = body.rejectionReason;
    }
    // Declining: the seller's reason for the store's records, and a message
    // the shopper is always sent — see the admin route.
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
      // In transit while the parcel is still on its way; recorded after it
      // arrived, the return stays where it is.
      const tracked = returnStatusForTracking(before.status);
      if (tracked) updates.status = tracked;
      updates["shipment.trackingAddedBy"] = "staff";
      updates["shipment.trackingAddedAt"] = new Date();
    }

    // How the parcel comes back and where to — to one of this seller's own
    // locations. See `returnShippingUpdates`.
    Object.assign(
      updates,
      await returnShippingUpdates({ before, body, settings }),
    );

    // What this return is priced on top of — see the admin route.
    let priorUnits: Map<number, number> | null = null;
    const loadPriorUnits = async () => {
      priorUnits ??= await loadPriorReturnUnits({
        orderId: before.orderId,
        before: (before as { createdAt?: Date }).createdAt,
        excludeReturnId: before._id,
      });
      return priorUnits;
    };
    // The fees and delivery an admin set by hand, carried by every re-pricing
    // here so a seller's count never puts a waived fee back.
    const overrides = mergeReturnOverrides(before, {});

    // Taking back less than was asked for — the vendor's own goods, so their
    // call. Refused once money has moved, exactly as on the admin route: the
    // estimate is what caps the refund.
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
      // Counted already, it is worth what arrived — re-sending the approval
      // after a short count put the whole value back on the cap.
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

      // The estimate caps the refund, so it follows what actually came back —
      // but never underneath money already sent, exactly as on the admin
      // route: the count is recorded, and the shortfall goes to an admin.
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
        const alreadyRefunded = Number(before.actualRefund?.amount || 0);
        if (repriced && repriced.total < alreadyRefunded - 0.01) {
          shortReceipt = { refunded: alreadyRefunded, worth: repriced.total };
          // And no further than what was sent — see the admin route.
          updates.estimatedRefund = { ...repriced, total: alreadyRefunded };
        } else if (repriced) {
          updates.estimatedRefund = repriced;
        }
      }
    }

    if (
      body.status === RETURN_STATUS.REJECTED ||
      body.status === RETURN_STATUS.CANCELLED
    ) {
      updates.refundStatus = RETURN_REFUND_STATUS.NOT_REQUIRED;
    }

    // Checked before anything else happens, so a refused move never restocks
    // or refunds on the way.
    const statusProblem = returnStatusChangeProblem({
      from: before.status,
      to: updates.status as string | undefined,
      refundedAmount: before.actualRefund?.amount,
      restocked: returnHasRestocked(before),
    });
    if (statusProblem) throw new ValidationError(statusProblem);

    // Where a restock puts the goods: one of this seller's own locations.
    const restockLocationId = body.restoreInventoryOnRefund
      ? await assertRestockLocation(before, body.restockLocationId)
      : null;

    // Whether this request puts the goods back on the shelf — done once the
    // return itself is written, below, and only once the goods are back.
    const restocking =
      Boolean(body.restoreInventoryOnRefund) &&
      returnMayRestock(updates.status ?? before.status) &&
      returnGoodsBack({ ...before, ...updates });

    // Rejecting or cancelling holds only while nothing has been refunded and
    // nothing is back on the shelf, and every move of the status is re-checked
    // in the write — see the admin route.
    const releasing = releasesReturnQuantity(updates.status);
    const movesStatus =
      updates.status !== undefined &&
      String(updates.status) !== String(before.status);
    const writeFilter: Record<string, unknown> = { _id: id };
    if (releasing) {
      Object.assign(writeFilter, NOTHING_REFUNDED_ON_RETURN, NOTHING_RESTOCKED_ON_RETURN);
    }
    if (body.approvedItems) Object.assign(writeFilter, NOTHING_REFUNDED_ON_RETURN);
    if (movesStatus) writeFilter.status = before.status;
    let returnRequest = await ReturnRequest.findOneAndUpdate(
      writeFilter,
      { $set: updates },
      { returnDocument: "after", runValidators: true },
    )
      .populate("customerId", "name email phone")
      .lean();

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
            : "This return has already been refunded, so what was approved can no longer be changed",
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

    // Restocking is deliberately decoupled from the refund. A vendor inspects
    // what came back and puts the sellable units on the shelf again; whether
    // the shopper gets their money is a separate decision, and one this route
    // no longer makes.
    //
    // Only the RETURNED lines are restored — this used to credit the vendor's
    // whole consignment, items the shopper kept included — a step at a time as
    // the parcel arrives, never more than came back sellable, and never on a
    // return that has just been called off (`restockReturnStep`).
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
        responseExtras.restockFailed = true;
      } else if (outcome.kind === "restocked") {
        responseExtras.restockedLines = outcome.lines;
        const restocked = await ReturnRequest.findById(id)
          .populate("customerId", "name email phone")
          .lean();
        if (restocked) returnRequest = restocked;
      }
    }
    // Only an admin can recover the difference, so it is theirs to hear.
    if (shortReceipt) {
      const { notifyAdminsPaymentAnomaly } = await import(
        "@/lib/notifications/notifications"
      );
      const currency =
        (before.estimatedRefund as { currency?: string } | undefined)?.currency ||
        settings.general?.defaultCurrency ||
        "USD";
      await notifyAdminsPaymentAnomaly({
        title: "Less came back than was refunded",
        message: `Return ${before.returnNumber} on order #${before.orderNumber} was refunded ${shortReceipt.refunded.toFixed(2)} ${currency}, but what the seller recorded as arriving is worth ${shortReceipt.worth.toFixed(2)}. The count is recorded and the refund stands; recover the difference from the shopper, or write it off.`,
        dedupeKey: `return-short-receipt:${String(before._id)}`,
        link: `/admin/returns`,
      }).catch((err) =>
        console.error("Failed to report a short return receipt:", err),
      );
    }
    const statusChanged =
      returnRequest.status && String(returnRequest.status) !== String(before.status);
    const refundStatusChanged =
      returnRequest.refundStatus &&
      String(returnRequest.refundStatus) !== String(before.refundStatus);
    if (statusChanged || refundStatusChanged) {
      await notifyReturnRequestCustomer(
        returnRequest,
        String(returnRequest.status),
        settings,
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

    // Recorded against the ORDER through the same helpers the admin route uses,
    // so a seller's decision reads in the order's timeline exactly as the
    // store's does. A seller never issues a refund (refused above), so what
    // they can add next to a status move is the record of one they sent.
    const auditContext = createAuditContext(request, session, { vendorId: vendor._id });
    const auditedOrder = {
      _id: before.orderId,
      orderNumber: String(before.orderNumber || ""),
    };
    if (statusChanged) {
      await auditOrderReturn(auditContext, auditedOrder, {
        returnNumber: String(before.returnNumber || ""),
        from: String(before.status),
        to: String(returnRequest.status),
        // The seller's own reason with what the shopper was told, as the admin
        // route words it — the order timeline is staff-only.
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

    // The returns table swaps its row for this answer: the same walk-in label.
    const [shown] = await markWalkInReturns([
      { ...withoutRefundDestinationUnlessPayer(returnRequest), ...responseExtras },
    ]);
    return successResponse(shown);
  },
);
