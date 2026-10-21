import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import { decideVendorTaxRequest } from "@/lib/vendors/vendor-tax-requests";

const DecisionSchema = z.object({
  decision: z.enum(["approved", "declined"]),
  note: z.string().max(1000).optional(),
});

/**
 * PATCH /api/admin/tax-requests/[id] — approve (the products take the asked-for
 * tax) or decline (they keep theirs; the note tells the vendor why).
 */
export const PATCH = withApi<{ id: string }>(
  { auth: "admin", rateLimit: { action: "admin:taxRequests:decide", preset: "moderate" } },
  async ({ request, params, session }) => {
    const body = await validateBody(request, DecisionSchema);
    const decided = await decideVendorTaxRequest({
      requestId: params.id,
      decision: body.decision,
      note: body.note,
      actorId: session!.user.id,
      auditContext: createAuditContext(request, session!),
    });
    return successResponse(
      decided.toObject(),
      body.decision === "approved" ? "Tax change approved" : "Request declined",
    );
  },
);
