import { getSettings } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { validateQuery } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { buildStaffProductScopeFilter } from "@/lib/access/staff-scope";
import { InventoryReportQuery } from "@/lib/inventory/finance-report-contract";
import { inventoryValuationReport } from "@/lib/inventory/finance-reports";
export const GET = withApi({ auth: "admin-or-staff", staffPermissions: [STAFF_PERMISSIONS.VIEW_INVENTORY], rateLimit: { action: "inventory:valuation", preset: "lenient" } }, async ({ request, staff }) => {
  const query = validateQuery(request, InventoryReportQuery);
  const currency = query.currency ?? (await getSettings()).general?.defaultCurrency ?? "USD";
  // The page searches and pages its stock rows itself, so it takes more of them.
  return successResponse(await inventoryValuationReport({ ...query, currency, positionLimit: 2000, productFilter: buildStaffProductScopeFilter(staff?.scope), locationIds: staff?.scope?.locationIds }));
});
