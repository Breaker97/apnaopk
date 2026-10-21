import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { InventoryCostSourceRequest } from "@/contracts/mobile/biz/v1/inventory-finance";
import { inventoryRequestKey } from "@/lib/inventory/finance-recovery";
import { linkNonphysicalCost } from "@/lib/inventory/finance-cost-sources";
export const POST = withApi({ auth: "admin", rateLimit: { action: "inventory:cost-source", preset: "moderate" } }, async ({ request, session }) => successResponse(await linkNonphysicalCost(await validateBody(request, InventoryCostSourceRequest), session.user.id, inventoryRequestKey(request))));
