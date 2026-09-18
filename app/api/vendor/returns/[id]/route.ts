import { connectDB } from "@/lib/db";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { AdminUpdateReturnRequestSchema } from "@/lib/validations";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { getSettings } from "@/models/settings.model";
import { ReturnRequest } from "@/models";
import type { ReturnRequestItem } from "@/models/return-request.model";
import { RETURN_REFUND_STATUS, RETURN_STATUS } from "@/lib/returns/returns";
import { restoreInventory } from "@/lib/inventory/inventory";
import { notifyReturnRequestCustomer } from "@/lib/notifications/notifications";
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
      $or: [
        { ownerType: "vendor", ownerVendorId: vendor._id },
        { ownerType: { $exists: false }, vendorIds: vendor._id },
      ],
    })
      .populate("customerId", "name email phone")
      .lean();

    if (!returnRequest) return notFoundResponse("Return request");
    return successResponse(returnRequest);
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

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    const vendor = await requireApprovedVendorByUserId(session.user.id);

    const before = await ReturnRequest.findOne({
      _id: id,
      $or: [
        { ownerType: "vendor", ownerVendorId: vendor._id },
        { ownerType: { $exists: false }, vendorIds: vendor._id },
      ],
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

    // Restocking is deliberately decoupled from the refund. A vendor inspects
    // what came back and puts the sellable units on the shelf again; whether
    // the shopper gets their money is a separate decision, and one this route
    // no longer makes.
    //
    // Only the RETURNED lines are restored. This used to call
    // `restoreSubOrderInventory`, which credited stock for the vendor's whole
    // consignment — including items the shopper kept.
    if (body.restoreInventoryOnRefund) {
      // Atomic claim, so a repeated call cannot restock the same units twice.
      const claim = await ReturnRequest.findOneAndUpdate(
        { _id: id, inventoryRestored: { $ne: true } },
        { $set: { inventoryRestored: true } },
      ).lean();
      if (claim) {
        const restoreLines = (before.items as ReturnRequestItem[])
          .map((item) => ({
            productId: String(item.productId || ""),
            variantId: item.variantId ? String(item.variantId) : undefined,
            quantity: Number(
              item.quantityReceived ||
                item.quantityApproved ||
                item.quantityRequested ||
                0,
            ),
          }))
          .filter((line) => line.productId && line.quantity > 0);
        if (restoreLines.length > 0) {
          await restoreInventory(restoreLines).catch((err) =>
            console.error(
              "Failed to restore inventory on vendor return:",
              err,
            ),
          );
        }
      }
    }

    const returnRequest = await ReturnRequest.findByIdAndUpdate(
      id,
      { $set: updates },
      { returnDocument: "after", runValidators: true },
    )
      .populate("customerId", "name email phone")
      .lean();

    if (!returnRequest) return notFoundResponse("Return request");
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
    return successResponse(returnRequest);
  },
);
