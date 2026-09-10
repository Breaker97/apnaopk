import { z } from "zod";
import type { Types } from "mongoose";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { auditUpdate, createAuditContext } from "@/lib/audit";
import { BoostCampaign, PlatformPayment } from "@/models";
import type { IBoostCampaign } from "@/models/boostCampaign.model";
import { BoostSlotConflictError } from "@/lib/boosts/boost-slots";
import {
  assertBoostingEnabled,
  cancelBoostCampaign,
  pauseBoostCampaign,
  refreshBoostCredit,
  resumeBoostCampaign,
} from "@/lib/boosts/boosts";
import { BOOST_CANCEL_REASON } from "@/config/app.config";

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
  refundableAmount?: number;
}): Promise<IBoostCampaign | null> {
  const owed = Number(campaign.refundableAmount ?? 0);
  if (!(owed > 0) || !campaign.paymentId) return null;

  const payment = await PlatformPayment.findById(campaign.paymentId)
    .select("amount refundedAmount")
    .lean<{ amount?: number; refundedAmount?: number } | null>();
  if (!payment) return null;

  // Never above what was charged: the obligation is derived from days, and a
  // rounding disagreement must not let the ledger record a refund larger than
  // the payment it settles.
  const settled = Math.min(
    (payment.refundedAmount ?? 0) + owed,
    payment.amount ?? 0,
  );
  await PlatformPayment.updateOne(
    { _id: campaign.paymentId, refundedAmount: { $lt: settled } },
    { $set: { refundedAmount: settled } },
  );

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
