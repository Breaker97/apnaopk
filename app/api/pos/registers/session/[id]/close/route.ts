import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { closeRegisterSession, registerVendorScope } from "@/lib/pos/register-session";
import { resolvePosOperator } from "@/lib/pos/operator";
import { registerSessionView } from "@/lib/pos/register-session-dto";

const CloseSchema = z.object({
  countedCash: z.number().min(0),
  note: z.string().max(1000).optional(),
});

/**
 * POST /api/pos/registers/session/[id]/close — close the drawer with what was
 * counted. The answer is the Z report.
 */
export const POST = withApi<{ id: string }>(
  { auth: "user", rateLimit: { action: "pos:registers", preset: "lenient" } },
  async ({ request, params, session }) => {
    const vendorId = await registerVendorScope(session.user);
    const body = await validateBody(request, CloseSchema);
    const closed = await closeRegisterSession({
      vendorId,
      sessionId: params.id,
      countedCash: body.countedCash,
      note: body.note,
      by: (await resolvePosOperator(session.user, request.cookies)).id,
    });
    return successResponse(await registerSessionView(closed, null));
  },
);
