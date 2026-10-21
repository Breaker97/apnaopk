import { Product } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { ManualOrderPreviewSchema } from "@/lib/validations";
import {
  buildStaffProductScopeFilter,
  hasStaffScope,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import { priceManualOrder, resolveAdminOrderLines } from "@/lib/orders/create-admin-order";

/**
 * POST /api/admin/orders/preview — the manual order form's totals, worked
 * out the way the save charges them: each line taxed at its product's rate
 * unless the form typed one. Nothing is written.
 */
export const POST = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.CREATE_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
    rateLimit: { action: "admin:orders:preview", preset: "lenient" },
  },
  async ({ request, staff }) => {
    const body = await validateBody(request, ManualOrderPreviewSchema);
    const lines = await resolveAdminOrderLines(body.items);
    if (staff && hasStaffScope(staff.scope)) {
      const productIds = Array.from(new Set(lines.map((line) => String(line.product._id))));
      const allowed = await Product.countDocuments(
        mergeScopeFilter({ _id: { $in: productIds } }, buildStaffProductScopeFilter(staff.scope)),
      );
      if (allowed !== productIds.length) {
        throw new ValidationError("One or more products are outside this staff member's assigned scope");
      }
    }
    const settings = await getSettingsLean();
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
