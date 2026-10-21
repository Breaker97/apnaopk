import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { POS_REFUND_METHODS, takePOSReturn } from "@/lib/pos/pos-returns";
import { POSReturnLineSchema } from "@/lib/pos/pos-return-schema";
import { resolvePosOperator } from "@/lib/pos/operator";

const ReturnSchema = z.object({
  orderId: z.string().min(1).max(64),
  lines: z.array(POSReturnLineSchema).min(1).max(250),
  reason: z.string().min(1).max(100),
  note: z.string().max(1000).optional(),
  refundMethod: z.enum(POS_REFUND_METHODS),
  requestId: z.string().min(8).max(64),
  registerSessionId: z.string().max(64).optional(),
});

/**
 * POST /api/pos/returns — take goods back at the till against a counter sale:
 * open the return, receive it, restock the sellable units at the sale's
 * counter and refund it (lib/pos/pos-returns.ts). Retry with the same
 * `requestId`: a step already done is not done twice.
 */
export const POST = withApi(
  { auth: "user", rateLimit: { action: "pos:returns", preset: "moderate" } },
  async ({ request, session }) => {
    const body = await validateBody(request, ReturnSchema);
    const operator = await resolvePosOperator(session.user, request.cookies);
    return successResponse(await takePOSReturn(operator, body));
  },
);
