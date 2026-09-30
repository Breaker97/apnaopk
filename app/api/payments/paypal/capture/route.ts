import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { resolvePayPalCredentials } from "@/lib/settings/credentials";
import { systemActor } from "@/lib/orders/audit-order";
import { getSettings } from "@/models/settings.model";
import { NextResponse } from "next/server";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { finalizePayPalOrder } from "@/lib/payments/paypal-orders";
import { settlePreorderBalanceFromPayPal } from "@/lib/payments/preorder-balance-paypal";
import { settleOrderPayFromPayPal } from "@/lib/payments/order-pay";
import {
  findPlatformPaymentByPayPalOrderId,
  verifyPlatformPayment,
} from "@/lib/payments/platform-payments";
import * as z from "zod";
import { validateBody } from "@/lib/api/validate";

const PayPalCaptureSchema = z.object({
  orderId: z.string().max(200).optional(),
});

/**
 * Captures a PayPal order the shopper has just approved.
 *
 * Through `withApi` for its rate limit. This route takes money and is open to
 * guests, so a caller who can loop it is a caller who can hammer PayPal's API
 * with somebody else's order ids; lenient, because a shopper whose first
 * capture times out does legitimately try again.
 */
export const POST = withApi(
  {
    rateLimit: { action: "payments:paypal-capture", preset: "lenient" },
  },
  async ({ request }) => {
    const session = await auth.api.getSession({ headers: await headers() });
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    const body = await validateBody(request, PayPalCaptureSchema);
    const orderId = body?.orderId;
    if (!orderId) throw new ValidationError("PayPal orderId is required");

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

    // A "pay now" link paid with PayPal lands here as well, and is asked
    // before checkout's finalizer for the same reason the balance is: the
    // order already exists, so the finalizer would find no pending checkout
    // for it and fail a payment the shopper has already approved.
    const payLink = await settleOrderPayFromPayPal({
      paypalOrderId: orderId,
      settings,
      sessionUserId: session?.user?.id,
      customerEmail: session?.user?.email || undefined,
    });
    if (!payLink.notOurs) {
      return NextResponse.json({
        success: true,
        data: {
          orderPayLink: true,
          settled: true,
          alreadyPaid: payLink.alreadyPaid,
          orderId: payLink.orderId,
          orderNumber: payLink.orderNumber,
        },
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
  },
);
