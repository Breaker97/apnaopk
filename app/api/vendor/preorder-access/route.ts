import { connectDB } from "@/lib/db";
import { Vendor } from "@/models";
import { getSettings } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import {
  resolvePreorderPolicy,
  resolveVendorPreorderAccess,
} from "@/lib/orders/preorder-gating";
import { afterResponse } from "@/lib/after-response";
import { notifyAdminsPreorderAccessRequest } from "@/lib/notifications/notifications";

/**
 * Vendor-side pre-order access.
 *
 * GET says where this vendor stands and what the limits are, so the product
 * form can explain a refusal before the vendor hits it rather than after.
 * POST puts them in the admin's queue.
 *
 * Asking is deliberately not the same as being granted: the platform carries
 * the refund and the chargeback on every pre-order it sells, so somebody has
 * to look. What asking does is make the vendor visible — before this the only
 * way in was to email an admin who had no screen to act on it.
 */
export const GET = withApi(
  { auth: "user" },
  async ({ session }) => {
    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });
    const policy = resolvePreorderPolicy(settings.preorder);

    return successResponse({
      policy,
      // With approval switched off nobody is gated, so the honest answer is
      // "yes" regardless of what the vendor record happens to say.
      allowed: resolveVendorPreorderAccess(settings.preorder, vendor).allowed,
      requestedAt: vendor.preorder?.requestedAt || null,
      approvedAt: vendor.preorder?.approvedAt || null,
      note: vendor.preorder?.note || null,
    });
  },
);

export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:preorder-access:request", preset: "strict" },
  },
  async ({ session }) => {
    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const policy = resolvePreorderPolicy(settings.preorder);
    if (!policy.enabled) {
      throw new ValidationError("Pre-orders are switched off for this store");
    }

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });
    if (vendor.preorder?.enabled) {
      return successResponse({ alreadyEnabled: true });
    }

    // `$setOnInsert` semantics by hand: a second click must not reset the
    // vendor's place in a queue an admin is working down.
    const requestedAt = new Date();
    const stamped = await Vendor.updateOne(
      { _id: vendor._id, "preorder.requestedAt": null },
      { $set: { "preorder.requestedAt": requestedAt } },
    );

    // Only a request that actually joined the queue is announced — a vendor
    // clicking again while they wait must not email every admin a second time.
    if (stamped.modifiedCount > 0) {
      afterResponse(() =>
        notifyAdminsPreorderAccessRequest(
          {
            vendorId: String(vendor._id),
            storeName: vendor.storeName,
            ownerName: session.user.name || undefined,
            ownerEmail: session.user.email || undefined,
            requestedAt,
          },
          { settings },
        ),
      );
    }

    return successResponse({ requested: true });
  },
);
