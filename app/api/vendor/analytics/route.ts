import { connectDB } from "@/lib/db";
import { PRODUCT_STATUS } from "@/config/app.config";
import { Order, Product } from "@/models";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { assertVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { validateQuery } from "@/lib/api/validate";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";

const VendorAnalyticsQuerySchema = z.object({
  period: z.coerce.number().min(1).max(365).default(30),
});

/**
 * GET /api/vendor/analytics
 * Get vendor dashboard analytics
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:analytics", preset: "lenient" },
  },
  async ({ request, session }) => {
    const { period } = validateQuery(request, VendorAnalyticsQuerySchema);

    // The dashboard hides the analytics widget when this grant is revoked;
    // without the same check here the vendor could just call the endpoint and
    // read revenue, order counts, and top products anyway.
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_ANALYTICS,
      "You do not have permission to view analytics",
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    // Get vendor
    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    const vendorId = vendor._id;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);

    // Get vendor stats
    const [
      revenueStats,
      totalProducts,
      activeProducts,
      pendingOrders,
      recentOrders,
      salesByDay,
      topProducts,
      productStats,
    ] = await Promise.all([
      // Revenue from sub-orders. The leading $match (order-level fields) is
      // index-backed by { subOrders.vendorId, createdAt } and shrinks the input
      // to this vendor's orders before the $unwind explodes them.
      Order.aggregate([
        {
          $match: {
            "subOrders.vendorId": vendorId,
            status: { $ne: "cancelled" },
          },
        },
        { $unwind: "$subOrders" },
        { $match: { "subOrders.vendorId": vendorId } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$subOrders.subtotal" },
            totalOrders: { $sum: 1 },
            totalCommission: { $sum: "$subOrders.commission" },
          },
        },
      ]),
      // Total products
      Product.countDocuments({ vendorId }),
      // Active products ("published" is not a product status — the enum is
      // active/draft/unlisted, so the old literal always counted 0).
      Product.countDocuments({ vendorId, status: PRODUCT_STATUS.ACTIVE }),
      // Pending orders
      Order.countDocuments({
        "subOrders.vendorId": vendorId,
        "subOrders.status": "pending",
      }),
      // Recent orders (top-level items[] is not used below — only subOrders and
      // order-level fields — so it's left out of the projection).
      Order.find({ "subOrders.vendorId": vendorId })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("orderNumber total status createdAt subOrders")
        .lean(),
      // Sales by day. Leading $match (order-level, index-backed) before $unwind.
      Order.aggregate([
        {
          $match: {
            "subOrders.vendorId": vendorId,
            createdAt: { $gte: startDate },
            status: { $ne: "cancelled" },
          },
        },
        { $unwind: "$subOrders" },
        { $match: { "subOrders.vendorId": vendorId } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            revenue: { $sum: "$subOrders.subtotal" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Top selling products. Sourced from subOrders.items (the vendor's own line
      // items) with a leading index-backed $match on subOrders.vendorId, instead
      // of unwinding the top-level items[] of EVERY order and matching the
      // unindexed items.vendorId. Same all-time result, only this vendor's orders.
      Order.aggregate([
        {
          $match: {
            "subOrders.vendorId": vendorId,
            status: { $ne: "cancelled" },
          },
        },
        { $unwind: "$subOrders" },
        { $match: { "subOrders.vendorId": vendorId } },
        { $unwind: "$subOrders.items" },
        {
          $group: {
            _id: "$subOrders.items.productId",
            name: { $first: "$subOrders.items.name" },
            totalSold: { $sum: "$subOrders.items.quantity" },
            // Net of per-line discounts so these figures reconcile with
            // totalRevenue (subOrders.subtotal is computed after line
            // discounts).
            revenue: {
              $sum: {
                $subtract: [
                  {
                    $multiply: [
                      "$subOrders.items.price",
                      "$subOrders.items.quantity",
                    ],
                  },
                  { $ifNull: ["$subOrders.items.lineDiscount.amount", 0] },
                ],
              },
            },
          },
        },
        { $sort: { totalSold: -1 } },
        { $limit: 5 },
      ]),
      // Products by status
      Product.aggregate([
        { $match: { vendorId: vendorId } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const stats = revenueStats[0] || {
      totalRevenue: 0,
      totalOrders: 0,
      totalCommission: 0,
    };

    type VendorOrderRow = {
      orderNumber: string;
      status: string;
      createdAt: Date;
      subOrders?: Array<{
        vendorId?: { toString: () => string };
        subtotal?: number;
        status?: string;
      }>;
    };

    type ProductStatRow = {
      _id: string;
      count: number;
    };

    // Filter recent orders to show only vendor's items
    const filteredRecentOrders = (recentOrders as VendorOrderRow[]).map((order) => {
      const vendorSubOrder = order.subOrders?.find(
        (sub) => sub.vendorId?.toString() === vendorId.toString(),
      );
      return {
        orderNumber: order.orderNumber,
        total: vendorSubOrder?.subtotal || 0,
        status: vendorSubOrder?.status || order.status,
        createdAt: order.createdAt,
      };
    });

    return successResponse({
      stats: {
        totalRevenue: stats.totalRevenue,
        netRevenue: stats.totalRevenue - stats.totalCommission,
        totalOrders: stats.totalOrders,
        totalCommission: stats.totalCommission,
        totalProducts,
        activeProducts,
        pendingOrders,
      },
      recentOrders: filteredRecentOrders,
      salesByDay,
      topProducts,
      productStats: (productStats as ProductStatRow[]).reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {} as Record<string, number>),
    });
  },
);
