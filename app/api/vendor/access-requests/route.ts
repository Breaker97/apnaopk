import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { getSettings, Vendor } from "@/models";
import {
  VENDOR_ACCESS_REQUEST_DURATIONS,
  VENDOR_ACCESS_REQUEST_STATUS,
  VendorAccessRequest,
  type VendorAccessRequestDuration,
} from "@/models/vendorAccessRequest.model";
import {
  ALL_VENDOR_PACKS,
  VENDOR_PACK_LABELS,
  type VendorPermissionPack,
} from "@/config/permissions.config";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { createdResponse, successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import {
  VENDOR_ACCESS_FIELDS,
  loadVendorAccess,
  type VendorAccessSubject,
} from "@/lib/vendors/vendor-permissions";
import { notifyAdminsOfAccessRequest } from "@/lib/vendors/vendor-access-requests";
import { z } from "zod";
import { validateOptionalBody } from "@/lib/api/validate";

/** The vendor's own requests, newest first. */
const AccessRequestSchema = z.object({
  pack: z.string().max(60).optional(),
  reason: z.string().max(2000).optional(),
  duration: z.union([z.string().max(40), z.number()]).optional(),
});

export const GET = withApi(
  { auth: "user", rateLimit: { action: "vendor:accessRequests:list", preset: "lenient" } },
  async ({ session }) => {
    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await Vendor.findOne({ userId: session!.user.id })
      .select("_id")
      .lean<{ _id: Types.ObjectId } | null>();
    if (!vendor) throw new NotFoundError("Vendor");

    const requests = await VendorAccessRequest.find({ vendorId: vendor._id })
      .sort({ requestedAt: -1 })
      .limit(50)
      .lean();

    return successResponse(
      requests.map((request) => ({
        ...request,
        packLabel: VENDOR_PACK_LABELS[request.pack as VendorPermissionPack],
      })),
    );
  },
);

/**
 * Ask for a pack the entitlement does not include.
 *
 * Deliberately refuses a request for something the vendor ALREADY holds, and
 * for something the marketplace policy has switched off — the first is noise in
 * the admin queue and the second is a request no admin can grant, so telling
 * the vendor now beats a decline three days later.
 */
export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:accessRequests:create", preset: "strict" },
  },
  async ({ request, session }) => {
    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const body = await validateOptionalBody(request, AccessRequestSchema);

    const pack = String(body?.pack ?? "") as VendorPermissionPack;
    if (!ALL_VENDOR_PACKS.includes(pack)) {
      throw new ValidationError("Unknown capability pack");
    }

    const reason = String(body?.reason ?? "").trim();
    if (reason.length < 10) {
      throw new ValidationError(
        "Add a sentence on why you need it — admins approve faster with a reason",
      );
    }
    if (reason.length > 1000) {
      throw new ValidationError("Reason cannot exceed 1000 characters");
    }

    const duration = String(
      body?.duration ?? VENDOR_ACCESS_REQUEST_DURATIONS.DAYS_30,
    ) as VendorAccessRequestDuration;
    if (!Object.values(VENDOR_ACCESS_REQUEST_DURATIONS).includes(duration)) {
      throw new ValidationError("Unknown duration");
    }

    const vendor = await Vendor.findOne({ userId: session!.user.id })
      .select(`${VENDOR_ACCESS_FIELDS} storeName`)
      // Typed as the access subject, not a two-field shape: `loadVendorAccess`
      // reads `status` off it to resolve the lifecycle layer, and a narrower
      // type would hide that the query has to keep selecting it.
      .lean<
        | (VendorAccessSubject & { _id: Types.ObjectId; storeName?: string })
        | null
      >();
    if (!vendor) throw new NotFoundError("Vendor");

    const access = await loadVendorAccess(vendor);
    const packState = access?.packs.find((state) => state.pack === pack);

    if (packState && packState.allowedCount === packState.total) {
      throw new ConflictError(
        `You already have ${VENDOR_PACK_LABELS[pack]} — try reloading the page`,
      );
    }
    if (packState?.policy === false) {
      throw new ValidationError(
        `${VENDOR_PACK_LABELS[pack]} is switched off for every store on this marketplace, so an admin cannot grant it. Contact support instead.`,
      );
    }

    // The partial unique index on (vendorId, pack) for pending rows is the real
    // guard against duplicates; this only turns the write error into a message.
    const existing = await VendorAccessRequest.findOne({
      vendorId: vendor._id,
      pack,
      status: VENDOR_ACCESS_REQUEST_STATUS.PENDING,
    })
      .select("_id")
      .lean<{ _id: Types.ObjectId } | null>();
    if (existing) {
      throw new ConflictError(
        `You already have a pending request for ${VENDOR_PACK_LABELS[pack]}`,
      );
    }

    const created = await VendorAccessRequest.create({
      vendorId: vendor._id,
      pack,
      reason,
      duration,
      requestedBy: session!.user.id,
    });

    await notifyAdminsOfAccessRequest({
      storeName: vendor.storeName ?? "A vendor",
      pack,
      requestId: String(created._id),
    });

    return createdResponse(created.toObject());
  },
);
