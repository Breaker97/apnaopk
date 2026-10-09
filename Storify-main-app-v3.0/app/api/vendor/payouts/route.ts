import { connectDB } from "@/lib/db";
import { getSettings } from "@/models";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { NotFoundError } from "@/lib/api/errors";
import { paginatedResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";
import { fetchPayoutList } from "@/lib/finance/payout-list";
import { parsePageLimit } from "@/lib/api/list-query";

export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_PAYOUTS,
      "You do not have permission to view payouts",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:payouts:list",
      "lenient",
      session.user.role,
    );

    const { searchParams } = new URL(request.url);
    const { page, limit } = parsePageLimit(searchParams, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const status = (searchParams.get("status") || "all").trim().toLowerCase();
    const search = (searchParams.get("search") || "").trim();
    const sortBy = (searchParams.get("sortBy") || "createdAt").trim();
    const sortOrder = (searchParams.get("sortOrder") || "desc").trim();

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    const vendor = await requireApprovedVendorByUserId(session.user.id);

    const list = await fetchPayoutList(
      {
        page,
        limit,
        search,
        status,
        sortBy,
        sortOrder: sortOrder === "asc" ? "asc" : "desc",
      },
      { vendorId: vendor._id },
    );

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);
