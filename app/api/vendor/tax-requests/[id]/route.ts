import { getSettingsLean } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { createAuditContext } from "@/lib/audit";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { USER_ROLES } from "@/config/app.config";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { withdrawVendorTaxRequest } from "@/lib/vendors/vendor-tax-requests";

/** DELETE /api/vendor/tax-requests/[id] — withdraw a request the store has not answered. */
export const DELETE = withApi<{ id: string }>(
  { auth: "user", rateLimit: { action: "vendor:taxRequests:withdraw", preset: "moderate" } },
  async ({ request, params, session }) => {
    if (session!.user.role !== USER_ROLES.VENDOR && session!.user.role !== USER_ROLES.ADMIN) {
      throw new AuthorizationError();
    }
    await assertVendorPermission(
      session!.user,
      VENDOR_PERMISSIONS.EDIT_PRODUCTS,
      "You do not have permission to edit products",
    );
    const settings = await getSettingsLean();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    const vendor = await requireApprovedVendorByUserId(session!.user.id, { allowPaymentRequiredSetup: true });
    if (!vendor) throw new AuthorizationError("Vendor profile not found");
    const withdrawn = await withdrawVendorTaxRequest({
      requestId: params.id,
      vendor: vendor as unknown as { _id: unknown; storeName?: string },
      userId: session!.user.id,
      auditContext: createAuditContext(request, session!, { vendorId: String(vendor._id) }),
    });
    return successResponse(withdrawn.toObject(), "Request withdrawn");
  },
);
