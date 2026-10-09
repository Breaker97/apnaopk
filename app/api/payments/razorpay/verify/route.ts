import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { checkRazorpayPayment } from "@/lib/payments/razorpay-verify";
import {
  SHOPPING_ADDRESS_ALLOWANCE,
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import * as z from "zod";
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
        SHOPPING_ADDRESS_ALLOWANCE,
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

    // The signature, the payment read back, and the order settled — see
    // lib/payments/razorpay-verify.ts.
    const check = await checkRazorpayPayment({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      settings,
      sessionUserId: session?.user?.id,
      cartSessionId,
      customerEmail: session?.user?.email,
    });
    const result = await check.settle();

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
