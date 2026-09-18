import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { NotFoundError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { connectDB } from "@/lib/db";
import { listProductAttributeSuggestions } from "@/lib/products/attribute-suggestions-query";
import { getSettings } from "@/models/settings.model";

/**
 * GET /api/vendor/products/attribute-suggestions
 *
 * The vendor's OWN specification labels and values — never another seller's
 * — for the product form's autocomplete.
 */
export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  await assertVendorPermission(
    session.user,
    VENDOR_PERMISSIONS.VIEW_PRODUCTS,
    "You do not have permission to view products",
  );
  await rateLimitByUser(
    request,
    session.user.id,
    "vendor:products:attribute-suggestions",
    "lenient",
    session.user.role,
  );

  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
  const vendor = await requireApprovedVendorByUserId(session.user.id, {
    allowPaymentRequiredSetup: true,
  });

  const suggestions = await listProductAttributeSuggestions({
    vendorId: vendor._id,
  });
  return successResponse({ suggestions });
});
