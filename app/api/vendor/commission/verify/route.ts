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
import { connectDB } from "@/lib/db";
import { isAdmin } from "@/lib/access/rbac";
import { PlatformPayment } from "@/models";
import { CommissionInvoice } from "@/models/commissionInvoice.model";
import { getSettings } from "@/models/settings.model";
import { verifyPlatformPayment } from "@/lib/payments/platform-payments";

const VerifySchema = z.object({
  paymentId: ObjectIdSchema,
  razorpayPaymentId: z.string().max(100).optional(),
  razorpaySignature: z.string().max(200).optional(),
});

/**
 * POST /api/vendor/commission/verify
 * Authoritative status re-check for a commission settlement attempt — the
 * counterpart to /api/vendor/boosts/checkout/verify on the invoice rail.
 *
 * Called on return from a redirect gateway, from the Razorpay modal handler,
 * and as the ioTec mobile-money poll. The IPN/webhook is the async belt; this
 * is the braces, so the vendor sees the debt clear instead of staring at an
 * invoice that still reads "open" because the notification is slow.
 */
export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:commission:verify", preset: "lenient" },
  },
  async ({ request, session }) => {
    await connectDB();
    const body = await validateBody(request, VerifySchema);

    const payment = await PlatformPayment.findOne({
      _id: body.paymentId,
      kind: PLATFORM_PAYMENT_KIND.COMMISSION,
    });
    if (!payment) throw new NotFoundError("Payment");
    const user = session.user;
    if (payment.userId !== session.user.id && !isAdmin(user)) {
      throw new NotFoundError("Payment");
    }

    // A superseded attempt (the vendor started a new checkout for the same
    // invoice) must not be verified into a capture — send them to their latest
    // checkout instead of silently settling against stale money.
    if (
      payment.status === PLATFORM_PAYMENT_STATUS.EXPIRED ||
      payment.status === PLATFORM_PAYMENT_STATUS.FAILED
    ) {
      throw new ValidationError(
        "This payment attempt is no longer valid. Start a new payment.",
      );
    }
    if (payment.status === PLATFORM_PAYMENT_STATUS.REFUNDED) {
      throw new ValidationError(
        "This payment was reversed, so the invoice is outstanding again.",
      );
    }

    const settings = await getSettings();
    const { paid } = await verifyPlatformPayment(payment, settings, {
      razorpayPaymentId: body.razorpayPaymentId,
      razorpaySignature: body.razorpaySignature,
    });

    const invoice = payment.commissionInvoiceId
      ? await CommissionInvoice.findById(payment.commissionInvoiceId)
          .select("status")
          .lean<{ status?: string } | null>()
      : null;

    return successResponse({
      paid,
      invoiceStatus: invoice?.status ?? null,
    });
  },
);
