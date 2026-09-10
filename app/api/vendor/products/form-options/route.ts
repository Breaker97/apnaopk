import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { NotFoundError } from "@/lib/api/errors";
import { assertVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { buildProductFormOptions } from "@/lib/products/form-options";
import { resolveLocationScope } from "@/lib/inventory/inventory-location-scope";

/**
 * GET /api/vendor/products/form-options
 *
 * Vendor counterpart of the admin route: the same reference payload, but the
 * shipping context resolves against this vendor's own shipping profile when the
 * platform allows vendor shipping.
 */
export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  const user = session.user;
  await assertVendorPermission(
    user,
    VENDOR_PERMISSIONS.VIEW_PRODUCTS,
    "You do not have permission to view products",
  );

  await rateLimitByUser(
    request,
    session.user.id,
    "vendor:products:form-options",
    "lenient",
    session.user.role,
  );

  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

  const vendor = await requireApprovedVendorByUserId(session.user.id, {
    allowPaymentRequiredSetup: true,
  });

  return successResponse(
    await buildProductFormOptions({
      includeInactiveCategories: false,
      vendorShipping: (vendor as unknown as { shipping?: unknown }).shipping,
      scope: await resolveLocationScope(session.user, "read"),
    }),
  );
});
