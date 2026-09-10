import { z } from "zod";
import { ObjectIdSchema } from "@/lib/validations";
import {
  PLATFORM_PAYMENT_KIND,
  PLATFORM_PAYMENT_STATUS,
} from "@/config/app.config";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import { isAdmin } from "@/lib/access/rbac";
import { BoostCampaign, PlatformPayment } from "@/models";
import { getSettings } from "@/models/settings.model";
import { verifyPlatformPayment } from "@/lib/payments/platform-payments";

const VerifySchema = z.object({
  paymentId: ObjectIdSchema,
  razorpayPaymentId: z.string().max(100).optional(),
  razorpaySignature: z.string().max(200).optional(),
});

/**
 * POST /api/vendor/boosts/checkout/verify
 * Authoritative status re-check for a boost payment attempt. Called on
 * return from redirect gateways, from the Razorpay modal handler (with the
 * signature payload), and as the ioTec mobile-money poll — so the vendor
 * sees the boost go live even when the async webhook is slow.
 *
 * Deliberately not gated on boosting.enabled: an admin turning the feature
 * off must not orphan money already sent to a gateway.
 */
export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:boosts:verify", preset: "lenient" },
  },
  async ({ request, session }) => {
    const body = await validateBody(request, VerifySchema);

    const payment = await PlatformPayment.findOne({
      _id: body.paymentId,
      kind: PLATFORM_PAYMENT_KIND.BOOST,
    });
    if (!payment) throw new NotFoundError("Payment");
    const user = session.user;
    if (payment.userId !== session.user.id && !isAdmin(user)) {
      throw new NotFoundError("Payment");
    }
    // A superseded attempt (vendor started a new checkout, possibly for a
    // different rung or range) must not be payable-then-verified — tell the vendor
    // to use their latest checkout instead of silently capturing stale money.
    if (
      payment.status === PLATFORM_PAYMENT_STATUS.EXPIRED ||
      payment.status === PLATFORM_PAYMENT_STATUS.FAILED
    ) {
      throw new ValidationError(
        "This payment attempt is no longer valid. Start a new checkout.",
      );
    }
    // A reversed charge is terminal. verifyPlatformPayment refuses to
    // resurrect it too, but say so here rather than reporting a bare
    // "not paid" the vendor would read as "try again".
    if (payment.status === PLATFORM_PAYMENT_STATUS.REFUNDED) {
      throw new ValidationError(
        "This payment was refunded. Start a new checkout to boost this product.",
      );
    }

    const settings = await getSettings();
    const { paid } = await verifyPlatformPayment(payment, settings, {
      razorpayPaymentId: body.razorpayPaymentId,
      razorpaySignature: body.razorpaySignature,
    });

    const campaign = payment.campaignId
      ? await BoostCampaign.findById(payment.campaignId)
          .select("status endsAt")
          .lean<{ status?: string; endsAt?: Date | null } | null>()
      : null;

    return successResponse({
      paid,
      campaignStatus: campaign?.status ?? null,
      endsAt: campaign?.endsAt ? campaign.endsAt.toISOString() : null,
    });
  },
);
