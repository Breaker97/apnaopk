import { Product } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { ManualOrderPreviewSchema } from "@/lib/validations";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { enforceTeamRoleForUser } from "@/lib/access/team-route-guard";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { priceManualOrder, resolveAdminOrderLines } from "@/lib/orders/create-admin-order";

/**
 * POST /api/vendor/orders/preview — a vendor's manual order form totals,
 * worked out the way the save charges them (app/api/vendor/orders). Only the
 * vendor's own products may be priced. Nothing is written.
 */
export const POST = withApi(
  { auth: "user", rateLimit: { action: "vendor:orders:preview", preset: "lenient" } },
  async ({ request, session }) => {
    const user = session!.user;
    await enforceTeamRoleForUser(request, user);
    const allowed =
      isAdmin(user) ||
      (await hasVendorPermission(user, VENDOR_PERMISSIONS.CREATE_ORDERS)) ||
      (await hasVendorPermission(user, VENDOR_PERMISSIONS.MANAGE_ORDERS));
    if (!allowed) throw new AuthorizationError("You do not have permission to create orders");

    const settings = await getSettingsLean();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    const vendor = await requireApprovedVendorByUserId(user.id);

    const body = await validateBody(request, ManualOrderPreviewSchema);
    const productIds = Array.from(new Set(body.items.map((line) => line.productId)));
    const owned = await Product.countDocuments({ _id: { $in: productIds }, vendorId: vendor._id });
    if (owned !== productIds.length) {
      throw new ValidationError("One or more selected products do not belong to your store");
    }
    const lines = await resolveAdminOrderLines(body.items);
    const { plan, ...totals } = await priceManualOrder({
      lines,
      discount: body.discount,
      shippingCost: body.shippingCost,
      taxRate: body.taxRate,
      storeRate: Number(settings.orders?.taxRate) || 0,
      currency: settings.general?.defaultCurrency || "USD",
    });
    return successResponse({ ...totals, automaticTax: plan.automatic });
  },
);
