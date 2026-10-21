import * as z from "zod";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import { mutationKey } from "@/lib/finance/operations";
import { voidVendorRepayment } from "@/lib/finance/vendor-repayments";

const VoidSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
  requestKey: z.string().min(8).max(160).optional(),
});

/** Undo a repayment recorded by mistake, or whose money came back. */
export const POST = withApi<{ id: string; repaymentId: string }>(
  { auth: "admin", rateLimit: { action: "admin:vendor-repayments:void", preset: "moderate" } },
  async ({ request, params, session }) => {
    const body = await validateBody(request, VoidSchema);
    await connectDB();
    if (!(await getSettings()).multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    const outcome = await voidVendorRepayment({
      vendorId: params.id,
      repaymentId: params.repaymentId,
      reason: body.reason,
      actorId: session.user.id,
      requestKey: mutationKey(request, body.requestKey),
      auditContext: createAuditContext(request, session),
    });
    return successResponse(
      { ...outcome.data, operationId: outcome.operationId, bookkeepingState: outcome.bookkeepingState },
      "Repayment undone",
    );
  },
);
