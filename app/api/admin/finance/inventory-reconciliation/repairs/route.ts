import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { InventoryPostingRepairRequest } from "@/contracts/mobile/biz/v1/inventory-finance";
import { inventoryRequestKey, retryInventoryPosting } from "@/lib/inventory/finance-recovery";
export const POST = withApi({ auth: "admin", rateLimit: { action: "inventory:recovery", preset: "moderate" } }, async ({ request }) => {
  inventoryRequestKey(request);
  return successResponse(await retryInventoryPosting(await validateBody(request, InventoryPostingRepairRequest)));
});
