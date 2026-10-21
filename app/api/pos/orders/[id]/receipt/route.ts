import * as z from "zod";
import { getSettingsLean } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { loadAccessiblePOSOrder } from "@/lib/pos/pos-order-access";
import { sendPosReceipt } from "@/lib/pos/pos-receipt-delivery";

const ReceiptSchema = z.object({
  channel: z.enum(["email", "sms"]),
  /** Where to send it; the sale's own customer when left out. */
  to: z.string().trim().max(320).optional(),
});

/**
 * POST /api/pos/orders/[id]/receipt — email or text a counter sale's receipt.
 *
 * Reachable for exactly the sales the register may print an invoice for
 * (lib/pos/pos-order-access.ts). Rate limited per cashier, because it is a
 * way to make the store send mail and texts to an address the caller types.
 */
export const POST = withApi<{ id: string }>(
  { auth: "user", rateLimit: { action: "pos:receipts", preset: "moderate" } },
  async ({ request, params, session }) => {
    const order = await loadAccessiblePOSOrder(session.user, params.id);
    const body = await validateBody(request, ReceiptSchema);
    const settings = await getSettingsLean();
    const result = await sendPosReceipt({
      order,
      channel: body.channel,
      to: body.to || undefined,
      settings,
    });
    return successResponse(result);
  },
);
