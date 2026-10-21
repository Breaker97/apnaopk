import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { InventoryReceiptCorrectionRequest } from "@/contracts/mobile/biz/v1/inventory-finance";
import { inventoryRequestKey } from "@/lib/inventory/finance-recovery";
import { correctUnusedReceipt } from "@/lib/inventory/finance-receipt-corrections";
export const POST = withApi({ auth: "admin", rateLimit: { action: "inventory:receipt-correction", preset: "moderate" } }, async ({ request, session }) => successResponse(await correctUnusedReceipt(await validateBody(request, InventoryReceiptCorrectionRequest), session.user.id, inventoryRequestKey(request))));
