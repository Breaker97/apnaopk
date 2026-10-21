import { getSettings } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { validateQuery } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { InventoryReportQuery } from "@/lib/inventory/finance-report-contract";
import { inventoryValuationReport } from "@/lib/inventory/finance-reports";
export const GET = withApi({ auth: "admin", rateLimit: { action: "inventory:reconciliation", preset: "lenient" } }, async ({ request }) => { const query = validateQuery(request, InventoryReportQuery); const currency = query.currency ?? (await getSettings()).general?.defaultCurrency ?? "USD"; return successResponse(await inventoryValuationReport({ ...query, currency })); });
