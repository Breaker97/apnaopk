import { connectDB } from "@/lib/db";
import { getSettings, Order, Payout } from "@/models";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { NotFoundError } from "@/lib/api/errors";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { isValidObjectId } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";

export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_PAYOUTS,
      "You do not have permission to view payouts",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:payouts:read",
      "lenient",
      session.user.role,
    );

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Payout");

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    const vendor = await requireApprovedVendorByUserId(session.user.id);

    const payout = await Payout.findOne({
      _id: id,
      vendorId: vendor._id,
    }).lean();

    if (!payout) return notFoundResponse("Payout");

    const orderRows = await Order.find({
      _id: { $in: payout.orderIds || [] },
    })
      .select("orderNumber createdAt total paymentStatus status")
      .sort({ createdAt: -1 })
      .lean();

    return successResponse({
      payout,
      orders: orderRows,
    });
  },
);
