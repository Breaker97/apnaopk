import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { CustomerProfile, Order } from "@/models";
import { paginatedResponse, notFoundResponse } from "@/lib/api/response";
import { USER_ROLES } from "@/config/app.config";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffOrderScopeFilter,
  hasStaffScope,
  mergeScopeFilter,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/admin/customers/[id]/orders
 * Paginated order history for a single customer. `id` is the CustomerProfile
 * id; orders are keyed by the underlying User id.
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    let staffScope: StaffAccessScope | undefined;
    if (session.user.role !== USER_ROLES.ADMIN) {
      const access = await assertAdminOrStaffPermissions(
        session as unknown as { user: { id: string; role: string } },
        [STAFF_PERMISSIONS.VIEW_CUSTOMERS],
      );
      staffScope = access.staffScope;
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:customers:orders",
      "lenient",
      session.user.role,
    );

    const { id } = params;
    if (!Types.ObjectId.isValid(id)) {
      return notFoundResponse("Customer");
    }

    await connectDB();

    const profile = await CustomerProfile.findById(id)
      .select("userId isGuest email")
      .lean();
    if (!profile) {
      return notFoundResponse("Customer profile");
    }

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number(url.searchParams.get("limit")) || 10),
    );
    const skip = (page - 1) * limit;

    // Guest rows own their orders through the checkout email, not a userId.
    // The distinction matters beyond correctness: an undefined customerId is
    // silently dropped from the query, which would have matched every order
    // in the store.
    const ownerFilter = profile.userId
      ? { customerId: profile.userId }
      : profile.email
        ? { guestEmail: profile.email }
        : null;
    if (!ownerFilter) {
      return paginatedResponse([], page, limit, 0);
    }

    const query = mergeScopeFilter(
      ownerFilter,
      buildStaffOrderScopeFilter(staffScope),
    );

    // Staff with a scope that yields no orders for this customer see an empty
    // list rather than someone else's data.
    if (hasStaffScope(staffScope)) {
      const inScope = await Order.countDocuments(query);
      if (inScope === 0) {
        return paginatedResponse([], page, limit, 0);
      }
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .select(
          "orderNumber status paymentStatus total currency channel createdAt refundedTotal items",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(query),
    ]);

    const items = orders.map((order) => ({
      _id: String(order._id),
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      total: order.total ?? 0,
      currency: order.currency,
      channel: order.channel,
      itemCount: Array.isArray(order.items) ? order.items.length : 0,
      refundedTotal: order.refundedTotal ?? 0,
      createdAt: order.createdAt,
    }));

    return paginatedResponse(items, page, limit, total);
  },
);
