import * as z from "zod";
import { connectDB } from "@/lib/db";
import { PaymentTransaction, ReturnRequest } from "@/models";
import { RETURN_REFUND_STATUS } from "@/lib/returns/returns";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import { canIssueRefunds } from "@/lib/access/rbac";
import { createAuditContext } from "@/lib/audit";
import {
  auditOrderRefundSettled,
  auditOrderRefundVoided,
} from "@/lib/orders/audit-order";

const SettleRefundSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("settle"),
    /** How the money went: a bank transfer, a mobile money send, cash, the gateway. */
    method: z.string().trim().min(1).max(40),
    reference: z.string().trim().max(120).optional(),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    /** A refund waiting to be sent that should never have been recorded. */
    action: z.literal("void"),
    reason: z.string().trim().max(500).optional(),
  }),
]);

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
    const auditContext = createAuditContext(request, session);

    await connectDB();

    // Cancelled before anybody sent it — reversed exactly as a refund that
    // failed at the gateway, and a return it was for is open again.
    if (body.action === "void") {
      const { voidUnsentRefund } = await import("@/lib/orders/order-refund-sync");
      const voided = await voidUnsentRefund({
        transactionId: id,
        voidedBy: session.user.id,
        reason: body.reason,
      });
      await auditOrderRefundVoided(
        auditContext,
        { _id: voided.orderId, orderNumber: voided.orderNumber },
        { amount: voided.amount, currency: voided.currency, reason: body.reason },
      );
      return successResponse(voided, "Refund cancelled");
    }

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
    ).lean<{
      _id: unknown;
      orderId?: unknown;
      orderNumber?: string;
      grossAmount?: number;
      currency?: string;
    } | null>();

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

    // Out of the account it was really sent from — see
    // `postRefundSettlementReclass`.
    const { postRefundSettlementReclassSafely } = await import(
      "@/lib/finance/post-events"
    );
    postRefundSettlementReclassSafely({ refundId: settled._id, method: body.method });

    await auditOrderRefundSettled(
      auditContext,
      { _id: settled.orderId, orderNumber: settled.orderNumber },
      {
        amount: Number(settled.grossAmount || 0),
        currency: settled.currency,
        method: body.method,
        reference: body.reference,
      },
    );

    // A return refunded through Pesapal waited on this same approval, and one
    // the store pays by hand on this same transfer — see the return route —
    // so the same record settles it, and the shopper, who was told the refund
    // was on its way, now hears it has gone.
    const waitingReturns = await ReturnRequest.find({
      "actualRefund.paymentTransactionIds": settled._id,
      refundStatus: {
        $in: [RETURN_REFUND_STATUS.PROCESSING, RETURN_REFUND_STATUS.MANUAL_REQUIRED],
      },
    })
      .select("_id")
      .lean<Array<{ _id: unknown }>>();
    if (waitingReturns.length > 0) {
      const { notifyReturnRequestCustomer } = await import(
        "@/lib/notifications/notifications"
      );
      const { getSettings } = await import("@/models/settings.model");
      const settings = await getSettings();
      for (const waiting of waitingReturns) {
        const returnRequest = await ReturnRequest.findOneAndUpdate(
          {
            _id: waiting._id,
            refundStatus: {
              $in: [
                RETURN_REFUND_STATUS.PROCESSING,
                RETURN_REFUND_STATUS.MANUAL_REQUIRED,
              ],
            },
          },
          {
            $set: {
              refundStatus: RETURN_REFUND_STATUS.SUCCEEDED,
              "actualRefund.settledAt": new Date(),
              "actualRefund.settledBy": session.user.id,
              "actualRefund.settledMethod": body.method,
              ...(body.reference
                ? { "actualRefund.settledReference": body.reference }
                : {}),
            },
          },
          { returnDocument: "after" },
        ).lean();
        if (!returnRequest) continue;
        await notifyReturnRequestCustomer(
          returnRequest,
          String(returnRequest.status),
          settings,
        ).catch((err) =>
          console.error("Failed to tell a shopper their return refund went:", err),
        );
      }
    }

    return successResponse(settled, "Refund recorded as sent");
  },
);
