import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import {
  addCashEvent,
  registerSessionTotals,
  registerVendorScope,
} from "@/lib/pos/register-session";
import { resolvePosOperator } from "@/lib/pos/operator";
import { registerSessionView } from "@/lib/pos/register-session-dto";

const CashSchema = z.object({
  kind: z.enum(["in", "out", "no_sale"]),
  /** Ignored for "no_sale", which moves no money. */
  amount: z.number().nonnegative(),
  reason: z.string().max(300),
  requestId: z.string().max(100),
});

/** POST /api/pos/registers/session/[id]/cash — notes into or out of the drawer. */
export const POST = withApi<{ id: string }>(
  { auth: "user", rateLimit: { action: "pos:registers", preset: "lenient" } },
  async ({ request, params, session }) => {
    const vendorId = await registerVendorScope(session.user);
    const body = await validateBody(request, CashSchema);
    const updated = await addCashEvent({
      vendorId,
      sessionId: params.id,
      kind: body.kind,
      amount: body.amount,
      reason: body.reason,
      by: (await resolvePosOperator(session.user, request.cookies)).id,
      requestId: body.requestId,
    });
    return successResponse(await registerSessionView(updated, await registerSessionTotals(updated)));
  },
);
