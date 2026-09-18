import { z } from "zod";
import { connectDB } from "@/lib/db";
import { PaymentTransaction } from "@/models";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import { canIssueRefunds } from "@/lib/access/rbac";

const SettleRefundSchema = z.object({
  action: z.literal("settle"),
  /** How the money went: a bank transfer, a mobile money send, cash, the gateway. */
  method: z.string().trim().min(1).max(40),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

export const GET = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:payments:transactions:read", preset: "lenient" },
  },
  async ({ params }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Transaction");

    await connectDB();
    const transaction = await PaymentTransaction.findById(id).lean();
    if (!transaction) return notFoundResponse("Transaction");

    return successResponse(transaction);
  },
);

/**
 * Record that a refund waiting to be sent has been sent.
 *
 * A refund no gateway carries — or a Pesapal refund, which waits on Pesapal's
 * approval — used to be booked as succeeded with nothing to say whether the
 * shopper was ever paid. Such a row carries `metadata.settlement.required`
 * until this records how and when the money actually went, which is what
 * takes it off the "awaiting settlement" list.
 */
export const PATCH = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:payments:transactions:settle", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    if (!canIssueRefunds(session.user)) {
      throw new AuthorizationError("Only admins can record refund payments");
    }
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Transaction");
    const body = await validateBody(request, SettleRefundSchema);

    await connectDB();
    const settled = await PaymentTransaction.findOneAndUpdate(
      {
        _id: id,
        type: "refund",
        status: "succeeded",
        "metadata.settlement.required": true,
        "metadata.settlement.settledAt": { $exists: false },
      },
      {
        $set: {
          "metadata.settlement.settledAt": new Date(),
          "metadata.settlement.settledBy": session.user.id,
          "metadata.settlement.method": body.method,
          ...(body.reference ? { "metadata.settlement.reference": body.reference } : {}),
          ...(body.note ? { "metadata.settlement.note": body.note } : {}),
        },
      },
      { returnDocument: "after" },
    ).lean<{ _id: unknown } | null>();

    if (!settled) {
      const existing = await PaymentTransaction.findById(id)
        .select("type metadata.settlement")
        .lean<{ type?: string; metadata?: { settlement?: { required?: boolean; settledAt?: Date } } } | null>();
      if (!existing) return notFoundResponse("Transaction");
      throw new ValidationError(
        existing.metadata?.settlement?.settledAt
          ? "This refund is already recorded as sent"
          : "This refund was sent by the payment provider, so there is nothing to record",
      );
    }

    return successResponse(settled, "Refund recorded as sent");
  },
);
