import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Order, Vendor } from "@/models";
import { paginatedResponse, notFoundResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { getSettings } from "@/models/settings.model";
import { isDefaultVendorRecord } from "@/lib/vendors/multi-vendor";
import { withApi } from "@/lib/api/handler";

interface VendorOrderRow {
  _id: unknown;
  orderNumber?: string;
  status?: string;
  paymentStatus?: string;
  total?: number;
  currency?: string;
  channel?: string;
  createdAt?: Date;
  refundedTotal?: number;
  subOrderCount?: number;
  vendorStatus?: string;
  vendorSubtotal?: number;
  vendorCommission?: number;
  vendorEarnings?: number;
  vendorShippingCost?: number;
  vendorItemCount?: number;
}

/**
 * GET /api/admin/vendors/[id]/orders
 * Paginated order history for a single vendor. Orders carry the vendor linkage
 * on `subOrders[].vendorId` (see the `{ "subOrders.vendorId": 1 }` index), so
 * we match that rather than a top-level field.
 *
 * Every money/count/status field is taken from THIS vendor's sub-order, not
 * from the order envelope. On a multi-vendor order the order-level `total`,
 * `items` and `status` describe the whole basket — showing them on a vendor's
 * row overstates their sales and can contradict their own fulfilment state.
 * Sub-order subtotals are also what `getVendorSalesBreakdowns` sums, so the
 * rows now add up to the "Total sales" KPI, and they match what the vendor
 * sees on their own dashboard. Order-level context is returned alongside
 * (`orderStatus`, `orderTotal`) for the rows where the two differ.
 *
 * `paymentStatus` stays order-level on purpose: payment is captured and
 * refunded against the order, never per sub-order.
 */
export const GET = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:vendors:orders",
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

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number(url.searchParams.get("limit")) || 10),
    );
    const skip = (page - 1) * limit;

    const vendorObjectId = new Types.ObjectId(id);
    const query = { "subOrders.vendorId": vendorObjectId };
    const defaultCurrency = String(
      settings.general?.defaultCurrency || "",
    ).toUpperCase();

    const [orders, total] = await Promise.all([
      // Aggregation rather than find(): the row needs one specific element of
      // `subOrders` plus the array's length, and it must not ship the other
      // vendors' line items to the client to get them. $match → $sort is
      // covered by the { subOrders.vendorId, createdAt } index.
      Order.aggregate<VendorOrderRow>([
        { $match: query },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $addFields: {
            vendorSubOrder: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: { $ifNull: ["$subOrders", []] },
                    as: "sub",
                    cond: { $eq: ["$$sub.vendorId", vendorObjectId] },
                  },
                },
                0,
              ],
            },
            subOrderCount: { $size: { $ifNull: ["$subOrders", []] } },
          },
        },
        {
          $project: {
            orderNumber: 1,
            status: 1,
            paymentStatus: 1,
            total: 1,
            currency: 1,
            channel: 1,
            createdAt: 1,
            refundedTotal: 1,
            subOrderCount: 1,
            vendorStatus: "$vendorSubOrder.status",
            vendorSubtotal: "$vendorSubOrder.subtotal",
            vendorCommission: "$vendorSubOrder.commission",
            vendorEarnings: "$vendorSubOrder.vendorEarnings",
            vendorShippingCost: "$vendorSubOrder.shippingCost",
            vendorItemCount: {
              $size: { $ifNull: ["$vendorSubOrder.items", []] },
            },
          },
        },
      ]),
      Order.countDocuments(query),
    ]);

    const items = orders.map((order) => ({
      _id: String(order._id),
      orderNumber: order.orderNumber,
      // This vendor's fulfilment state. Legacy orders written before sub-order
      // statuses existed fall back to the order's.
      status: order.vendorStatus || order.status,
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
      total: order.vendorSubtotal ?? 0,
      orderTotal: order.total ?? 0,
      commission: order.vendorCommission ?? 0,
      vendorEarnings: order.vendorEarnings ?? 0,
      shippingCost: order.vendorShippingCost ?? 0,
      currency: order.currency || defaultCurrency || undefined,
      channel: order.channel,
      itemCount: order.vendorItemCount ?? 0,
      // True when the order carries other vendors' sub-orders, so the UI can
      // explain why the row total sits below the order total.
      isSplitOrder: Number(order.subOrderCount ?? 1) > 1,
      refundedTotal: order.refundedTotal ?? 0,
      createdAt: order.createdAt,
    }));

    return paginatedResponse(items, page, limit, total);
  },
);
