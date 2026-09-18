import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import {
  fetchRazorpayPayment,
  getRazorpayCredentials,
  verifyRazorpayPaymentSignature,
} from "@/lib/payments/razorpay";
import { finalizeRazorpayOrder } from "@/lib/payments/razorpay-orders";
import {
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

const RazorpayVerifySchema = z.object({
  razorpay_order_id: z.string().max(200).optional(),
  razorpay_payment_id: z.string().max(200).optional(),
  razorpay_signature: z.string().max(500).optional(),
});

export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    if (session?.user?.id) {
      await rateLimitByUser(
        request,
        session.user.id,
        "payments:razorpay-verify",
        "strict",
        session.user.role,
      );
    } else if (cartSessionId) {
      await rateLimitBySession(
        request,
        cartSessionId,
        "payments:razorpay-verify",
        "strict",
      );
    } else {
      await rateLimitByIP(request, "strict");
    }

    const body = await validateBody(request, RazorpayVerifySchema);

    const razorpayOrderId = body?.razorpay_order_id;
    const razorpayPaymentId = body?.razorpay_payment_id;
    const razorpaySignature = body?.razorpay_signature;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw new ValidationError("Razorpay payment verification data is missing");
    }

    await connectDB();
    const settings = await getSettings();
    const razorpay = settings.payment?.razorpay;

    if (!razorpay?.enabled) {
      throw new ValidationError("Razorpay is disabled");
    }

    const creds = getRazorpayCredentials({
      keyId: razorpay.keyId,
      keySecret: razorpay.keySecret,
    });

    const isValidSignature = verifyRazorpayPaymentSignature({
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature,
      keySecret: creds.keySecret,
    });

    if (!isValidSignature) {
      throw new ValidationError("Razorpay payment signature mismatch");
    }

    const payment = await fetchRazorpayPayment({
      creds,
      paymentId: razorpayPaymentId,
    });

    const result = await finalizeRazorpayOrder({
      razorpayOrderId,
      payment,
      creds,
      settings,
      sessionUserId: session?.user?.id,
      cartSessionId,
      customerEmail: session?.user?.email,
    });

    return NextResponse.json({
      success: true,
      data: {
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        alreadyPaid: result.alreadyPaid,
      },
    });
  },
);
