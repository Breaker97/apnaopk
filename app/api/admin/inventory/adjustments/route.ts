import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { inventoryRequestKey } from "@/lib/inventory/finance-recovery";
import { adjustFinancialInventory } from "@/lib/inventory/finance-actions";
import { InventoryAdjustmentSchema } from "@/lib/inventory/finance-contracts";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { buildStaffProductScopeFilter } from "@/lib/access/staff-scope";
import { allowedLocationIds, resolveLocationScope } from "@/lib/inventory/inventory-location-scope";
import { revalidateProductContent } from "@/lib/cache-invalidation";
export const POST = withApi({ auth: "admin-or-staff", staffPermissions: [STAFF_PERMISSIONS.EDIT_INVENTORY, STAFF_PERMISSIONS.MANAGE_INVENTORY], rateLimit: { action: "inventory:adjust", preset: "moderate" } }, async ({ request, session, staff }) => {
  const body = await validateBody(request, InventoryAdjustmentSchema);
  const result = await adjustFinancialInventory(body, session.user.id, inventoryRequestKey(request), { productFilter: buildStaffProductScopeFilter(staff?.scope), locationIds: await allowedLocationIds(await resolveLocationScope(session.user, "write")) });
  if (!body.preview) revalidateProductContent();
  return successResponse(result);
});
