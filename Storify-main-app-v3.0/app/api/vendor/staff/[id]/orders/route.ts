import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { StaffProfile } from "@/models";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { handleApiError } from "@/lib/api/errors";
import { requireVendorStaffPermission } from "@/lib/access/vendor-staff-guard";
import { fetchStaffOrders, fetchStaffOrderStats } from "@/lib/access/staff-orders";
import { VENDOR_OWNED_STAFF_FILTER } from "@/lib/access/staff-ownership";
import { parsePageLimit } from "@/lib/api/list-query";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/vendor/staff/[id]/orders
 * The vendor-side twin of the admin route, narrowed to orders this vendor has
 * a line in — a shared staff member's sales for other stores stay invisible.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { vendor } = await requireVendorStaffPermission(
      request,
      [
        VENDOR_PERMISSIONS.VIEW_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
      ],
      "vendor:staff:read",
      "lenient",
    );

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return notFoundResponse("Staff member");

    const profile = await StaffProfile.findOne({
      userId: id,
      vendorIds: vendor._id,
      ...VENDOR_OWNED_STAFF_FILTER,
    })
      .select("_id")
      .lean();
    if (!profile) return notFoundResponse("Staff member");

    const searchParams = request.nextUrl.searchParams;
    const stats = await fetchStaffOrderStats({
      staffId: id,
      vendorId: vendor._id,
    });

    if (searchParams.get("statsOnly") === "true") {
      return successResponse({
        data: [],
        pagination: {
          page: 1,
          limit: 0,
          total: stats.orderCount,
          totalPages: 1,
        },
        stats,
      });
    }

    const { page, limit } = parsePageLimit(searchParams, {
      defaultLimit: 10,
      maxLimit: 100,
    });
    const { data, pagination } = await fetchStaffOrders({
      staffId: id,
      vendorId: vendor._id,
      page: Number.isNaN(page) ? 1 : page,
      limit: Number.isNaN(limit) ? 10 : limit,
      channel: searchParams.get("channel") || "all",
    });

    return successResponse({ data, pagination, stats });
  } catch (error) {
    return handleApiError(error);
  }
}
