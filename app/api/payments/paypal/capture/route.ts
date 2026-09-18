import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { headers } from "next/headers";
import { resolvePayPalCredentials } from "@/lib/settings/credentials";
import { systemActor } from "@/lib/orders/audit-order";
import { getSettings } from "@/models/settings.model";
import { NextRequest, NextResponse } from "next/server";
import { handleApiError, ValidationError } from "@/lib/api/errors";
import { finalizePayPalOrder } from "@/lib/payments/paypal-orders";
import { settlePreorderBalanceFromPayPal } from "@/lib/payments/preorder-balance-paypal";
import {
  findPlatformPaymentByPayPalOrderId,
  verifyPlatformPayment,
} from "@/lib/payments/platform-payments";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

const PayPalCaptureSchema = z.object({
  orderId: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    const body = await validateBody(request, PayPalCaptureSchema);
    const orderId = body?.orderId;
    if (!orderId) throw new ValidationError("PayPal orderId is required");

    await connectDB();
    const settings = await getSettings();

    const paypal = settings.payment?.paypal;
    if (!paypal?.enabled) throw new ValidationError("PayPal is disabled");
    const paypalCreds = resolvePayPalCredentials(paypal);
    if (!paypalCreds.clientId || !paypalCreds.clientSecret) {
      throw new ValidationError("PayPal is not configured");
    }

    // Vendor→platform payments (boosts, subscriptions) share this capture
    // route. PayPal's reference_id never round-trips, so the dispatch key is
    // the PlatformPayment's stored paypalOrderId; verifyPlatformPayment runs
    // the capture + amount checks itself.
    const platformPayment = await findPlatformPaymentByPayPalOrderId(orderId);
    if (platformPayment) {
      // Unlike guest order checkout, a platform payment always belongs to a
      // signed-in vendor — require the owner, don't just check when present.
      if (!session?.user?.id || platformPayment.userId !== session.user.id) {
        throw new ValidationError("Order not found for PayPal capture");
      }
      const { paid } = await verifyPlatformPayment(platformPayment, settings);
      return NextResponse.json({
        success: true,
        data: { platformPayment: true, paid },
      });
    }

    // A pre-order balance paid with PayPal comes back through this route too —
    // PayPal returns every approval the same way. It is tried before checkout's
    // finalizer, which would find no pending order for it and fail a payment
    // the shopper has already approved. Not a balance at all → falls through.
    const balance = await settlePreorderBalanceFromPayPal({
      paypalOrderId: orderId,
      settings,
    });
    if (balance.reason !== "not_a_balance_order") {
      return NextResponse.json({
        success: true,
        data: {
          preorderBalance: true,
          // Paid now, or paid already — either way the shopper owes nothing.
          settled: balance.settled || Boolean(balance.alreadySettled),
          orderId: balance.orderId,
          orderNumber: balance.orderNumber,
          reason: balance.reason,
        },
      });
    }

    // Money is taken inside the finalizer, only for an order that is still
    // pending and not cancelled; a replayed capture answers with the order
    // number and takes nothing twice.
    const result = await finalizePayPalOrder({
      paypalOrderId: orderId,
      creds: {
        clientId: paypalCreds.clientId,
        clientSecret: paypalCreds.clientSecret,
        mode: paypalCreds.mode,
      },
      settings,
      sessionUserId: session?.user?.id,
      cartSessionId,
      customerEmail: session?.user?.email || undefined,
      actor: systemActor(request),
    });

    return NextResponse.json({
      success: true,
      data: { orderNumber: result.orderNumber },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
