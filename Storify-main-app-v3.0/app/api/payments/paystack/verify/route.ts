import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import {
  assertPaystackEnabled,
  checkPaystackPayment,
} from "@/lib/payments/paystack-verify";
import { isPlatformPaymentReference } from "@/models/platformPayment.model";
import {
  findPlatformPaymentByReference,
  verifyPlatformPayment,
} from "@/lib/payments/platform-payments";
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
        SHOPPING_ADDRESS_ALLOWANCE,
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
    assertPaystackEnabled(settings);

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

    // The transaction read back and the order settled whatever its state —
    // the finalizer refuses one that is not a success. See
    // lib/payments/paystack-verify.ts.
    const check = await checkPaystackPayment({
      reference,
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
