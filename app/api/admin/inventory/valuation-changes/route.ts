import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { inventoryRequestKey } from "@/lib/inventory/finance-recovery";
import { revalueFinancialInventory } from "@/lib/inventory/finance-actions";
import { InventoryRevaluationSchema } from "@/lib/inventory/finance-contracts";
import { revalidateProductContent } from "@/lib/cache-invalidation";
export const POST = withApi({ auth: "admin", rateLimit: { action: "inventory:revalue", preset: "moderate" } }, async ({ request, session }) => {
  const body = await validateBody(request, InventoryRevaluationSchema);
  const result = await revalueFinancialInventory(body, session.user.id, inventoryRequestKey(request));
  if (!body.preview) revalidateProductContent();
  return successResponse(result);
});
