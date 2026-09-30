import { connectDB } from "@/lib/db";
import { getSettings, Order, Product, User, Vendor } from "@/models";
import { narrowedToStoreCurrency } from "@/lib/intl/currency-scope";
import { successResponse } from "@/lib/api/response";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffOrderScopeFilter,
  buildStaffProductScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import {
  DEFAULT_VENDOR_SLUG,
  getExternalVendorFilter,
} from "@/lib/vendors/multi-vendor";
import { withApi } from "@/lib/api/handler";
import {
  COLLECTED_ORDER_MATCH,
  placedOrderMatch,
} from "@/lib/orders/order-payment-status";

/**
 * GET /api/admin/analytics
 * Get admin dashboard analytics
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_ANALYTICS],
    );

    await connectDB();

    const searchParams = request.nextUrl.searchParams;
    const period = searchParams.get("period") || "30"; // days

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));
    const orderScope = buildStaffOrderScopeFilter(access.staffScope);
    // Every money figure below is printed with one symbol, so it may only add
    // up one currency — see `lib/intl/currency-scope.ts`. The counts beside
    // them stay whole. Trade in another currency is Finance's to report, in
    // that currency.
    const settings = await getSettings();
    const storeCurrency = settings.general?.defaultCurrency || "USD";
    /** A money filter, narrowed to the store's own currency. */
    const money = (filter: Record<string, unknown>) =>
      narrowedToStoreCurrency(filter, storeCurrency);
    const productScope = buildStaffProductScopeFilter(access.staffScope);

    // Get overall stats
    const [
      totalRevenue,
      totalOrders,
      totalProducts,
      totalUsers,
      totalVendors,
      pendingOrders,
      recentOrders,
      salesByDay,
      topProducts,
      topVendors,
    ] = await Promise.all([
      // Total revenue. Money collected, not orders written: `status != cancelled`
      // counted every checkout that was abandoned at a gateway as revenue.
      Order.aggregate([
        { $match: mergeScopeFilter(money(COLLECTED_ORDER_MATCH), orderScope) },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),
      // Total orders — placed, cancellations excluded. This counted everything
      // in the collection, abandoned gateway attempts and cancellations alike.
      Order.countDocuments(
        mergeScopeFilter(
          { ...placedOrderMatch(), status: { $ne: "cancelled" } },
          orderScope,
        ),
      ),
      // Total products
      Product.countDocuments(mergeScopeFilter({ status: "published" }, productScope)),
      // Total users
      User.countDocuments(),
      // Total vendors
      Vendor.countDocuments({ ...getExternalVendorFilter(), status: "approved" }),
      // Pending orders — the ones a person is waiting on. Without the placed
      // match this was mostly abandoned gateway checkouts, which also sit on
      // `status: "pending"`.
      Order.countDocuments(
        mergeScopeFilter(
          { ...placedOrderMatch(), status: "pending" },
          orderScope,
        ),
      ),
      // Recent orders
      Order.find(mergeScopeFilter(placedOrderMatch(), orderScope))
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("customerId", "name email")
        .lean(),
      // Sales by day (last N days)
      Order.aggregate([
        {
          $match: mergeScopeFilter(
            money({ createdAt: { $gte: startDate }, ...COLLECTED_ORDER_MATCH }),
            orderScope,
          ),
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            revenue: { $sum: "$total" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Top selling products
      Order.aggregate([
        { $match: mergeScopeFilter(money(COLLECTED_ORDER_MATCH), orderScope) },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.productId",
            name: { $first: "$items.name" },
            totalSold: { $sum: "$items.quantity" },
            revenue: {
              $sum: { $multiply: ["$items.price", "$items.quantity"] },
            },
          },
        },
        { $sort: { totalSold: -1 } },
        { $limit: 5 },
      ]),
      // Top vendors
      Order.aggregate([
        { $match: mergeScopeFilter(money(COLLECTED_ORDER_MATCH), orderScope) },
        { $unwind: "$subOrders" },
        {
          $group: {
            _id: "$subOrders.vendorId",
            totalOrders: { $sum: 1 },
            revenue: { $sum: "$subOrders.subtotal" },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "vendors",
            localField: "_id",
            foreignField: "_id",
            as: "vendor",
          },
        },
        { $unwind: "$vendor" },
        {
          $match: {
            "vendor.isDefault": { $ne: true },
            "vendor.slug": { $ne: DEFAULT_VENDOR_SLUG },
          },
        },
        {
          $project: {
            vendorId: "$_id",
            storeName: "$vendor.storeName",
            totalOrders: 1,
            revenue: 1,
          },
        },
      ]),
    ]);

    // Calculate period comparison
    const previousStartDate = new Date(startDate);
    previousStartDate.setDate(previousStartDate.getDate() - parseInt(period));

    const [previousRevenue, previousOrders] = await Promise.all([
      Order.aggregate([
        {
          $match: mergeScopeFilter(
            money({
              createdAt: { $gte: previousStartDate, $lt: startDate },
              ...COLLECTED_ORDER_MATCH,
            }),
            orderScope,
          ),
        },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),
      Order.countDocuments(
        mergeScopeFilter(
          {
            createdAt: { $gte: previousStartDate, $lt: startDate },
            ...placedOrderMatch(),
            status: { $ne: "cancelled" },
          },
          orderScope,
        ),
      ),
    ]);

    const currentRevenue = totalRevenue[0]?.total || 0;
    const prevRevenue = previousRevenue[0]?.total || 0;
    const revenueChange =
      prevRevenue > 0
        ? ((currentRevenue - prevRevenue) / prevRevenue) * 100
        : 0;

    const currentOrders = totalOrders;
    const ordersChange =
      previousOrders > 0
        ? ((currentOrders - previousOrders) / previousOrders) * 100
        : 0;

    return successResponse({
      stats: {
        totalRevenue: currentRevenue,
        revenueChange: Math.round(revenueChange * 10) / 10,
        totalOrders,
        ordersChange: Math.round(ordersChange * 10) / 10,
        totalProducts,
        totalUsers,
        totalVendors,
        pendingOrders,
      },
      recentOrders,
      salesByDay,
      topProducts,
      topVendors,
    });
  },
);
