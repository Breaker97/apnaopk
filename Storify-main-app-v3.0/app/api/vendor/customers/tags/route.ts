import { connectDB } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { requireVendorCustomerListPermission } from "@/lib/vendors/vendor-customer-access";
import { fetchVendorCustomerTags } from "@/lib/customers/customer-list";
import { getSettings } from "@/models/settings.model";

/**
 * GET /api/vendor/customers/tags
 * Every tag on this seller's customers, for the list's Tag filter — only the
 * people who have bought from them, never the store-wide tag list.
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await requireVendorCustomerListPermission(session.user);

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:customers:tags",
      "lenient",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    return successResponse({ tags: await fetchVendorCustomerTags(vendor._id) });
  },
);
