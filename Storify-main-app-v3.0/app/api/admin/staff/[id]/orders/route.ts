import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { User } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { TEAM_USER_ROLES } from "@/lib/access/staff-role";
import { isVendorOwnedStaff } from "@/lib/access/staff-ownership";
import { fetchStaffOrders, fetchStaffOrderStats } from "@/lib/access/staff-orders";
import { parsePageLimit } from "@/lib/api/list-query";

/**
 * GET /api/admin/staff/[id]/orders
 *
 * Backs the Orders tab on the staff detail page. `statsOnly=true` returns just
 * the header figures, which is what the shell asks for on load — the table
 * pages itself separately.
 */
export const GET = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params }) => {
    const { id } = params;
    if (!Types.ObjectId.isValid(id)) return notFoundResponse("Staff member");

    await connectDB();

    // TEAM_USER_ROLES, not STAFF_USER_ROLES — administrators open on this
    // detail page too, and their POS/admin-created orders carry their id.
    const user = await User.findOne({
      _id: id,
      role: { $in: TEAM_USER_ROLES },
    })
      .select("_id")
      .lean();
    if (!user) return notFoundResponse("Staff member");

    // Vendor-owned staff are out of scope for the admin.
    if (await isVendorOwnedStaff(id)) return notFoundResponse("Staff member");

    const searchParams = request.nextUrl.searchParams;
    const statsOnly = searchParams.get("statsOnly") === "true";
    const stats = await fetchStaffOrderStats({ staffId: id });

    if (statsOnly) {
      return successResponse({
        data: [],
        pagination: { page: 1, limit: 0, total: stats.orderCount, totalPages: 1 },
        stats,
      });
    }

    const { page, limit } = parsePageLimit(searchParams, {
      defaultLimit: 10,
      maxLimit: 100,
    });
    const { data, pagination } = await fetchStaffOrders({
      staffId: id,
      page: Number.isNaN(page) ? 1 : page,
      limit: Number.isNaN(limit) ? 10 : limit,
      channel: searchParams.get("channel") || "all",
    });

    return successResponse({ data, pagination, stats });
  },
);
