import { isValidObjectId, type Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Vendor } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  VENDOR_ACCESS_REQUEST_STATUS,
  VendorAccessRequest,
} from "@/models/vendorAccessRequest.model";
import { ConflictError, NotFoundError } from "@/lib/api/errors";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { audit, createAuditContext } from "@/lib/audit";
import { VENDOR_PACK_LABELS } from "@/config/permissions.config";

/**
 * DELETE /api/vendor/access-requests/[id]
 *
 * Withdraw a request the vendor no longer needs — they bought the upgrade
 * instead, or the campaign it was for is over.
 *
 * Withdrawn rather than deleted: an admin may already have read it, and "we
 * asked and then thought better of it" is part of the same history the decided
 * rows keep. It also frees the partial unique index on (vendorId, pack), so the
 * vendor can ask again later with a better reason.
 */
export const DELETE = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:accessRequests:withdraw", preset: "moderate" },
  },
  // `request` is taken under another name: the access request found below is
  // the one this file is about, and owns the plain one.
  async ({ request: httpRequest, params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Access request");

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await Vendor.findOne({ userId: session!.user.id })
      .select("_id storeName")
      .lean<{ _id: Types.ObjectId; storeName?: string } | null>();
    if (!vendor) throw new NotFoundError("Vendor");

    // Scoped to the caller's own vendor, so one store cannot withdraw another's.
    const request = await VendorAccessRequest.findOne({
      _id: id,
      vendorId: vendor._id,
    });
    if (!request) return notFoundResponse("Access request");

    if (request.status !== VENDOR_ACCESS_REQUEST_STATUS.PENDING) {
      throw new ConflictError(
        "This request has already been decided, so there is nothing to withdraw",
      );
    }

    request.status = VENDOR_ACCESS_REQUEST_STATUS.WITHDRAWN;
    request.decidedBy = session!.user.id;
    request.decidedAt = new Date();
    await request.save();

    // `DELETE` because the request is gone from the admin's queue, though the
    // document stays (see the header).
    await audit(
      createAuditContext(httpRequest, session!, { vendorId: vendor._id }),
      {
        action: "DELETE",
        resource: "vendor",
        resourceId: String(vendor._id),
        resourceName: vendor.storeName,
        changes: {
          summary: `Withdrew the request for ${VENDOR_PACK_LABELS[request.pack]} access`,
        },
        // Not `requestId`: `audit()` lets metadata overwrite that key, and it is
        // the id that groups the rows one HTTP request wrote.
        metadata: { accessRequestId: String(request._id), pack: request.pack },
      },
    );

    return successResponse(request.toObject(), "Request withdrawn");
  },
);
