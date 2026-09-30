import * as z from "zod";
import type { Types } from "mongoose";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { auditUpdate, createAuditContext } from "@/lib/audit";
import { BoostCampaign, PlatformPayment } from "@/models";
import { refundedBelowMatch } from "@/models/platformPayment.model";
import type { IBoostCampaign } from "@/models/boostCampaign.model";
import { BoostSlotConflictError } from "@/lib/boosts/boost-slots";
import {
  assertBoostingEnabled,
  cancelBoostCampaign,
  pauseBoostCampaign,
  refreshBoostCredit,
  resumeBoostCampaign,
} from "@/lib/boosts/boosts";
import {
  BOOST_CANCEL_REASON,
  PLATFORM_PAYMENT_KIND,
  PLATFORM_PAYMENT_STATUS,
} from "@/config/app.config";

type RouteParams = { id: string };

/**
 * Record that an outstanding boost credit has been paid back.
 *
 * The obligation is computed from released days, but nothing computes when it
 * is DISCHARGED — a gateway refund is issued by a human in the gateway's own
 * dashboard, and a `manual`-provider booking never had a gateway at all. Without
 * this the ledger only ever grows and `refundableAmount` is a number nobody can
 * clear.
 *
 * It writes the cash onto the payment attempt and recomputes the obligation
 * from it, so the credit formula stays the single definition of what is owed.
 */
async function settleBoostRefundManually(campaign: {
  _id: unknown;
  paymentId?: unknown;
  paidAttemptId?: unknown;
  refundableAmount?: number;
}): Promise<IBoostCampaign | null> {
  const owed = Number(campaign.refundableAmount ?? 0);
  if (!(owed > 0)) return null;

  // `paymentId` is stamped by a SUCCESSFUL fulfilment only. A booking whose
  // fulfilment was refused — the terms drifted, or its window closed while the
  // gateway held the vendor — and one the hold sweep closed as paid-but-never-
  // granted both carry the whole charge as a credit with no `paymentId` at
  // all. That is precisely the case where money was collected and nothing was
  // delivered, so it is the last row whose obligation may be unclearable:
  // fall back to the attempt the campaign recorded, then to the PAID attempt
  // itself.
  const paymentId =
    campaign.paymentId ??
    campaign.paidAttemptId ??
    (
      await PlatformPayment.findOne({
        kind: PLATFORM_PAYMENT_KIND.BOOST,
        campaignId: campaign._id as Types.ObjectId,
        status: PLATFORM_PAYMENT_STATUS.PAID,
      })
        .sort({ paidAt: -1 })
        .select("_id")
        .lean<{ _id: unknown } | null>()
    )?._id;
  if (!paymentId) return null;

  const payment = await PlatformPayment.findById(paymentId)
    .select("amount refundedAmount kind reference vendorId currency provider")
    .lean<{
      amount?: number;
      refundedAmount?: number;
      kind?: string;
      reference?: string;
      vendorId?: unknown;
      currency?: string;
      provider?: string;
    } | null>();
  if (!payment) return null;

  // Never above what was charged: the obligation is derived from days, and a
  // rounding disagreement must not let the ledger record a refund larger than
  // the payment it settles.
  const settled = Math.min(
    (payment.refundedAmount ?? 0) + owed,
    payment.amount ?? 0,
  );
  // Claimed, not merely written: two admins pressing "Mark refunded" at once
  // must book the money once. The winner learns what the total was BEFORE it,
  // which is the step the books take — see `platformPaymentRefundPostings`.
  const claimed = await PlatformPayment.findOneAndUpdate(
    { _id: paymentId, ...refundedBelowMatch(settled) },
    { $set: { refundedAmount: settled } },
    { returnDocument: "before" },
  )
    .select("refundedAmount")
    .lean<{ refundedAmount?: number } | null>();

  if (claimed) {
    const { postPlatformPaymentRefundSafely } = await import(
      "@/lib/finance/post-events"
    );
    postPlatformPaymentRefundSafely({
      _id: paymentId,
      kind: payment.kind,
      reference: payment.reference,
      vendorId: payment.vendorId,
      currency: payment.currency,
      provider: payment.provider,
      refundedTotal: settled,
      previouslyRefunded: claimed.refundedAmount ?? 0,
      refundedAt: new Date(),
    });
  }

  await refreshBoostCredit(campaign._id as Types.ObjectId);
  return BoostCampaign.findById(campaign._id as Types.ObjectId);
}

const ActionSchema = z.object({
  action: z.enum(["pause", "resume", "cancel", "mark_refunded"]),
});

/**
 * GET /api/admin/boosts/campaigns/[id]
 */
export const GET = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:boostCampaigns:read", preset: "lenient" },
  },
  async ({ params }) => {
    await assertBoostingEnabled();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Boost campaign");
    const campaign = await BoostCampaign.findById(id)
      .populate("productId", "name slug images")
      .populate("vendorId", "storeName")
      .lean();
    if (!campaign) return notFoundResponse("Boost campaign");
    return successResponse(campaign);
  },
);

/**
 * PATCH /api/admin/boosts/campaigns/[id]
 * Admin moderation: pause, resume, cancel.
 *
 * Pause RELEASES the remaining days rather than parking them: strict indexing
 * hands the visual slot to a regular product anyway, so holding them would give
 * the inventory away free and pay the vendor nothing. Resume is therefore
 * fallible — someone may have bought those days — and says which ones went.
 * Money owed is tracked on the campaign; the admin settles it at the gateway.
 */
export const PATCH = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:boostCampaigns:update", preset: "moderate" },
    demo: "block-mutations",
  },
  async ({ request, params, session }) => {
    await assertBoostingEnabled();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Boost campaign");
    const { action } = await validateBody(request, ActionSchema);

    const before = await BoostCampaign.findById(id).lean();
    if (!before) return notFoundResponse("Boost campaign");

    let updated: IBoostCampaign | null = null;
    if (action === "mark_refunded") {
      updated = await settleBoostRefundManually(before);
    } else if (action === "resume") {
      const result = await resumeBoostCampaign(id);
      if (result && result.ok === false) {
        // Name the days someone else bought rather than failing silently — the
        // admin has to tell the vendor something specific.
        throw new BoostSlotConflictError(
          before.positionSnapshot?.position ?? 0,
          result.conflictDays,
        );
      }
      updated = result?.ok ? result.campaign : null;
    } else if (action === "pause") {
      updated = await pauseBoostCampaign(id);
    } else {
      updated = await cancelBoostCampaign(id, BOOST_CANCEL_REASON.ADMIN);
    }

    if (!updated) {
      throw new ValidationError(
        action === "mark_refunded"
          ? "There is nothing outstanding to settle on this campaign"
          : `This campaign cannot be ${action}d from its current state`,
      );
    }

    const auditContext = createAuditContext(request, session);
    await auditUpdate(
      auditContext,
      "boostCampaign",
      id,
      before as unknown as Record<string, unknown>,
      updated.toObject() as unknown as Record<string, unknown>,
    );

    return successResponse(updated);
  },
);
