import { z } from "zod";
import { connectDB } from "@/lib/db";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { AuthorizationError } from "@/lib/api/errors";
import { canIssueRefunds } from "@/lib/access/rbac";
import { createAuditContext } from "@/lib/audit";
import { recordPreorderBalanceOffline } from "@/lib/payments/preorder-balance";

const BodySchema = z.object({
  amount: z.number().positive(),
  /** How the money reached the store — free text, shown in the timeline. */
  method: z.string().min(1).max(60),
  reference: z.string().min(1).max(120),
  receivedAt: z.coerce.date().optional(),
  note: z.string().max(1000).optional(),
});

/**
 * POST /api/admin/preorders/[id]/record-balance
 *
 * Write down a pre-order balance that arrived outside the gateway.
 *
 * Storify takes deposits on any gateway but can only charge a balance through
 * Stripe, so stores on Razorpay, Paystack, MoMo and the rest have orders stuck
 * `partially_paid` with no way to finish. Checkout no longer creates them, but
 * the ones already in the database need a way out, and until now the code only
 * *defended against* an admin recording a balance offline — there was nowhere
 * to do it.
 *
 * Gated by `canIssueRefunds` (admin only), the same gate as moving money the
 * other way: this writes a payment into the ledger without a gateway to verify
 * it against, so it is exactly as consequential as a refund.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "admin:preorders:record-balance", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    if (!canIssueRefunds(session.user)) {
      throw new AuthorizationError(
        "You do not have permission to record payments",
      );
    }

    const body = await validateBody(request, BodySchema);
    await connectDB();

    const result = await recordPreorderBalanceOffline({
      orderId: params.id,
      amount: body.amount,
      method: body.method,
      reference: body.reference,
      receivedAt: body.receivedAt,
      note: body.note,
      auditContext: createAuditContext(request, session),
    });

    return successResponse(result);
  },
);
