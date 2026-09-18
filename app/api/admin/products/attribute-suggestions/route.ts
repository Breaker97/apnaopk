import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { listProductAttributeSuggestions } from "@/lib/products/attribute-suggestions-query";

/**
 * GET /api/admin/products/attribute-suggestions
 *
 * Specification labels (and their values) already used across the catalogue,
 * for the product form's autocomplete.
 */
export const GET = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.VIEW_PRODUCTS],
  },
  async ({ request, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:products:attribute-suggestions",
      "lenient",
      session.user.role,
    );
    const suggestions = await listProductAttributeSuggestions({});
    return successResponse({ suggestions });
  },
);
