import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { fetchAdminCustomerTags } from "@/lib/customers/customer-list";

/**
 * GET /api/admin/customers/tags
 * Every tag on the customers this viewer can see, for the list's Tag filter.
 */
export const GET = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.VIEW_CUSTOMERS],
    rateLimit: { action: "admin:customers:tags", preset: "lenient" },
  },
  async ({ staff }) => successResponse({ tags: await fetchAdminCustomerTags(staff?.scope) }),
);
