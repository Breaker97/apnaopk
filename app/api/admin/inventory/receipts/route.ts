import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { inventoryRequestKey } from "@/lib/inventory/finance-recovery";
import { receiveFinancialInventory } from "@/lib/inventory/finance-actions";
import { InventoryReceiptSchema } from "@/lib/inventory/finance-contracts";
import { revalidateProductContent } from "@/lib/cache-invalidation";
export const POST = withApi({ auth: "admin", rateLimit: { action: "inventory:receive", preset: "moderate" } }, async ({ request, session }) => {
  const body = await validateBody(request, InventoryReceiptSchema);
  const result = await receiveFinancialInventory(body, session.user.id, inventoryRequestKey(request));
  if (!body.preview) revalidateProductContent();
  return successResponse(result);
});
