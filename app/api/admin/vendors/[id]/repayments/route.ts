import * as z from "zod";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import { mutationKey } from "@/lib/finance/operations";
import { listVendorRepayments, recordVendorRepayment } from "@/lib/finance/vendor-repayments";

const RepaymentSchema = z.object({
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  amount: z.coerce.number().positive(),
  receivedInto: z.enum(["bank", "cash", "gateway"]),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(2000).optional(),
  receivedAt: z.string().max(40).optional(),
  requestKey: z.string().min(8).max(160).optional(),
});

async function assertMarketplace() {
  await connectDB();
  if (!(await getSettings()).multiVendorMode?.enabled) throw new NotFoundError("Vendor");
}

/** Repayments a seller has made by hand, newest first. */
export const GET = withApi<{ id: string }>(
  { auth: "admin", rateLimit: { action: "admin:vendor-repayments:list", preset: "lenient" } },
  async ({ request, params }) => {
    await assertMarketplace();
    const currency = new URL(request.url).searchParams.get("currency") || undefined;
    return successResponse(await listVendorRepayments(params.id, currency));
  },
);

/** Record money a seller paid back for sales refunded after their payout. */
export const POST = withApi<{ id: string }>(
  { auth: "admin", rateLimit: { action: "admin:vendor-repayments:create", preset: "moderate" } },
  async ({ request, params, session }) => {
    const body = await validateBody(request, RepaymentSchema);
    await assertMarketplace();
    const outcome = await recordVendorRepayment({
      ...body,
      vendorId: params.id,
      actorId: session.user.id,
      requestKey: mutationKey(request, body.requestKey),
      auditContext: createAuditContext(request, session),
    });
    return successResponse(
      { ...outcome.data, operationId: outcome.operationId, bookkeepingState: outcome.bookkeepingState },
      "Repayment recorded",
      outcome.bookkeepingState === "complete" ? 201 : 202,
    );
  },
);
