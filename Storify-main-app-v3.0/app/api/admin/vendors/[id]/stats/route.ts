import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Order, Product, Vendor } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { getSettings } from "@/models/settings.model";
import { isDefaultVendorRecord } from "@/lib/vendors/multi-vendor";
import { getVendorSalesBreakdowns } from "@/lib/vendors/vendor-sales";
import { ORDER_STATUS } from "@/config/app.config";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/admin/vendors/[id]/stats
 * On-demand commerce counts for the vendor detail header. The Vendor model has
 * no cached stats sub-document (unlike CustomerProfile), so counts are computed
 * here: products by `vendorId`, orders by `subOrders[].vendorId`.
 *
 * `orderCount` deliberately counts every order carrying one of this vendor's
 * sub-orders — the same set the Orders tab lists, so the KPI and the table
 * always agree. `totalSales` excludes cancelled orders (money that never
 * moved), which is why `cancelledOrderCount` is returned too: it accounts for
 * the gap between the two figures instead of leaving it unexplained.
 *
 * Commission is NOT returned here. It lives on the vendor document, which the
 * vendor GET lazily reconciles against an expired trial/period — reading it
 * from this parallel request would race that reconcile and show a stale rate.
 * The header sources it from the loaded vendor form instead.
 */
export const GET = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:vendors:stats",
      "lenient",
      session.user.role,
    );

    const { id } = params;
    if (!Types.ObjectId.isValid(id)) {
      return notFoundResponse("Vendor");
    }

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await Vendor.findById(id).select("isDefault slug").lean();
    if (!vendor || isDefaultVendorRecord(vendor)) {
      return notFoundResponse("Vendor");
    }

    const defaultCurrency = String(
      settings.general?.defaultCurrency || "USD",
    ).toUpperCase();
    const vendorObjectId = new Types.ObjectId(id);
    const [productCount, orderCount, cancelledOrderCount, breakdowns] =
      await Promise.all([
        Product.countDocuments({ vendorId: vendorObjectId }),
        Order.countDocuments({ "subOrders.vendorId": vendorObjectId }),
        Order.countDocuments({
          "subOrders.vendorId": vendorObjectId,
          status: ORDER_STATUS.CANCELLED,
        }),
        getVendorSalesBreakdowns([id], { defaultCurrency }),
      ]);

    const sales = breakdowns.get(vendorObjectId.toString());

    // `totalSales` already spans every currency the vendor traded in, relabelled
    // with the store default. The per-currency buckets are deliberately not on
    // the wire: rendering them beside this figure would show the same money
    // twice.
    return successResponse({
      productCount,
      orderCount,
      cancelledOrderCount,
      totalSales: sales?.primary ?? 0,
      currency: defaultCurrency,
    });
  },
);
