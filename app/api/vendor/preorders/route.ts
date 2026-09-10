import { connectDB } from "@/lib/db";
import { paginatedResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { assertVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { sanitizeSearchString } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import { fetchPreorderList } from "@/lib/orders/preorder-list";
import { parsePageLimit } from "@/lib/api/list-query";

export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_ORDERS,
      "You do not have permission to view orders",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:preorders:list",
      "lenient",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    const searchParams = request.nextUrl.searchParams;
    const { page, limit } = parsePageLimit(searchParams, {
      defaultLimit: 10,
      maxLimit: 100,
    });
    const search = sanitizeSearchString(
      (searchParams.get("search") || "").trim(),
    );
    const status = (searchParams.get("status") || "all").trim();
    const view = (searchParams.get("view") || "all").trim();

    const list = await fetchPreorderList(
      { page, limit, search, status, view },
      { vendorId: vendor._id },
    );

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);
