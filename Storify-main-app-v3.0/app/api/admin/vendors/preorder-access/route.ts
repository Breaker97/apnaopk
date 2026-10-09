import { connectDB } from "@/lib/db";
import { Vendor } from "@/models";
import { getSettings } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";

const VENDOR_FIELDS = "storeName slug logo status preorder";

/**
 * GET /api/admin/vendors/preorder-access
 *
 * The pre-order approval queue, and who already has access.
 *
 * Two lists rather than one, because they answer different questions: `pending`
 * is work — vendors who asked and are waiting on an admin — while `enabled` is
 * a standing exposure, the set of sellers currently able to take a shopper's
 * deposit on the platform's gateway.
 *
 * `policy` rides along so the screen can say what it is enforcing. A queue is
 * misleading on a store where `requireVendorApproval` is off: nobody is
 * actually being held back, and an admin working through it would think they
 * were granting something that was never withheld.
 */
export const GET = withApi(
  { auth: "admin" },
  async ({ request, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:vendors:preorder-access",
      "lenient",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();

    const [pending, enabled] = await Promise.all([
      Vendor.find({ "preorder.requestedAt": { $ne: null } })
        .select(VENDOR_FIELDS)
        .sort({ "preorder.requestedAt": 1 })
        .limit(200)
        .lean(),
      Vendor.find({ "preorder.enabled": true })
        .select(VENDOR_FIELDS)
        .sort({ "preorder.approvedAt": -1 })
        .limit(200)
        .lean(),
    ]);

    return successResponse({
      policy: resolvePreorderPolicy(settings.preorder),
      pending,
      enabled,
    });
  },
);
