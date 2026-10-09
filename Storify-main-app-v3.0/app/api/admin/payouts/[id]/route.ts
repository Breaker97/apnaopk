import { PAYOUT_REFERENCE_MAX } from "@/lib/finance/payout-policy";
import { connectDB } from "@/lib/db";
import { Payout } from "@/models";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import { updatePayout } from "@/lib/finance/payout-service";
import { payoutDetail } from "@/lib/finance/payout-dto";
import { mutationKey, expectedVersion } from "@/lib/finance/operations";
import { createAuditContext } from "@/lib/audit";
import * as z from "zod";

const PayoutUpdateSchema = z.object({
  status: z.enum(["pending", "processing", "paid", "failed", "cancelled"]).optional(),
  note: z.string().max(2000).optional(), paidFrom: z.enum(["bank", "cash", "gateway", ""]).optional(),
  paymentReference: z.string().trim().max(PAYOUT_REFERENCE_MAX).optional(), reversedAt: z.string().max(40).optional(),
  expectedVersion: z.number().int().min(0).optional(), requestKey: z.string().min(8).max(160).optional(),
});
export const GET = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:payouts:read", preset: "lenient" },
  },
  async ({ params }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Payout");

    await connectDB();
    const payout = await Payout.findById(id)
      .populate("vendorId", "storeName slug userId")
      .lean();
    if (!payout) return notFoundResponse("Payout");

    return successResponse(await payoutDetail(payout, true));
  },
);

export const PUT = withApi<{ id: string }>(
  { auth: "admin", rateLimit: { action: "admin:payouts:update", preset: "moderate" } },
  async ({ request, params, session }) => {
    if (!isValidObjectId(params.id)) return notFoundResponse("Payout");
    const body = await validateBody(request, PayoutUpdateSchema);
    await connectDB();
    const current = await Payout.findById(params.id).select("version").lean();
    const outcome = await updatePayout({ ...body, id: params.id, actorId: session.user.id, requestKey: mutationKey(request, body.requestKey), expectedVersion: expectedVersion(request, current?.version ?? 0, body.expectedVersion), auditContext: createAuditContext(request, session) });
    return successResponse({ ...outcome.data, operationId: outcome.operationId, bookkeepingState: outcome.bookkeepingState }, "Payout updated", outcome.bookkeepingState === "complete" ? 200 : 202);
  },
);
