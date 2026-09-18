import { connectDB } from "@/lib/db";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { getSettings } from "@/models/settings.model";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { productImportSampleResponse } from "@/lib/products/import-sample";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/vendor/products/import-export/sample?format=csv|json
 * The vendor's sample import file — the admin's without the columns a vendor
 * import ignores.
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const user = session.user;
    const canCreate = await hasVendorPermission(
      user,
      VENDOR_PERMISSIONS.CREATE_PRODUCTS,
    );
    const canEdit = await hasVendorPermission(
      user,
      VENDOR_PERMISSIONS.EDIT_PRODUCTS,
    );
    if (!canCreate && !canEdit && !isAdmin(user)) {
      throw new AuthorizationError(
        "You do not have permission to import products",
      );
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:products:import-sample",
      "lenient",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    return productImportSampleResponse(
      request.nextUrl.searchParams.get("format") === "json" ? "json" : "csv",
      "vendor",
    );
  },
);
