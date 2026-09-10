import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { isAdmin } from "@/lib/access/rbac";
import { buildProductFormOptions } from "@/lib/products/form-options";
import { resolveLocationScope } from "@/lib/inventory/inventory-location-scope";

/**
 * GET /api/admin/products/form-options
 *
 * Every dropdown the admin/staff product editor needs, in one projected
 * payload: categories (with breadcrumb paths and variant templates), assignable
 * brands, active collections, inventory locations and the shipping context.
 *
 * Gated like the product read itself (VIEW_PRODUCTS), since it only exposes
 * reference data an editor already sees.
 */
export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  await assertAdminOrStaffPermissions(
    session as unknown as { user: { id: string; role: string } },
    [STAFF_PERMISSIONS.VIEW_PRODUCTS],
  );

  await rateLimitByUser(
    request,
    session.user.id,
    "admin:products:form-options",
    "lenient",
    session.user.role,
  );

  return successResponse(
    await buildProductFormOptions({
      includeInactiveCategories: isAdmin(session.user),
      scope: await resolveLocationScope(session.user, "read"),
    }),
  );
});
