import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import {
  getPaystackCredentials,
  verifyPaystackTransaction,
} from "@/lib/payments/paystack";
import { finalizePaystackOrder } from "@/lib/payments/paystack-orders";
import { isPlatformPaymentReference } from "@/models/platformPayment.model";
import {
  findPlatformPaymentByReference,
  verifyPlatformPayment,
} from "@/lib/payments/platform-payments";
import {
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

const PaystackVerifySchema = z.object({
  reference: z.string().max(200).optional(),
});

export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    if (session?.user?.id) {
      await rateLimitByUser(
        request,
        session.user.id,
        "payments:paystack-verify",
        "strict",
        session.user.role,
      );
    } else if (cartSessionId) {
      await rateLimitBySession(
        request,
        cartSessionId,
        "payments:paystack-verify",
        "strict",
      );
    } else {
      await rateLimitByIP(request, "strict");
    }

    const body = await validateBody(request, PaystackVerifySchema);
    const reference = body?.reference;
    if (!reference) {
      throw new ValidationError("Paystack transaction reference is required");
    }

    await connectDB();
    const settings = await getSettings();
    const paystack = settings.payment?.paystack;

    if (!paystack?.enabled) {
      throw new ValidationError("Paystack is disabled");
    }

    // Vendor→platform payments (boosts, subscriptions) share this gateway;
    // their references are prefix-marked and never match an Order.
    if (isPlatformPaymentReference(reference)) {
      const platformPayment = await findPlatformPaymentByReference(reference);
      if (!platformPayment) {
        throw new ValidationError("Unknown Paystack transaction reference");
      }
      const { paid } = await verifyPlatformPayment(platformPayment, settings);
      return NextResponse.json({
        success: true,
        data: { platformPayment: true, paid },
      });
    }

    const creds = getPaystackCredentials({
      publicKey: paystack.publicKey,
      secretKey: paystack.secretKey,
    });
    const transaction = await verifyPaystackTransaction({ creds, reference });

    const result = await finalizePaystackOrder({
      reference,
      transaction,
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
