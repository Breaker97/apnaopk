import { connectDB } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { getSettings } from "@/models/settings.model";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { hasVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { withApi } from "@/lib/api/handler";
import { fetchVendorCollectionList } from "@/lib/vendors/vendor-collection-list";

export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const user = session.user;
    const canView = await hasVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_PRODUCTS,
    );
    if (!canView) {
      throw new AuthorizationError("You do not have permission to view collections");
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:collections:list",
      "lenient",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    const list = await fetchVendorCollectionList(
      new URL(request.url).searchParams,
      vendor._id,
    );

    return successResponse({
      data: list.items,
      pagination: {
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
        hasNext: list.page < list.totalPages,
        hasPrev: list.page > 1,
      },
    });  },
);
