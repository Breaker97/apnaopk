import { NextResponse } from "next/server";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  getPesapalCredentials,
  getPesapalTransactionState,
  getPesapalTransactionStatus,
} from "@/lib/payments/pesapal";
import {
  finalizePesapalOrder,
  reversePesapalOrder,
} from "@/lib/payments/pesapal-orders";
import { resolvePesapalCredentials } from "@/lib/settings/credentials";
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

const PesapalVerifySchema = z.object({
  orderTrackingId: z.string().max(500).optional(),
  merchantReference: z.string().max(500).optional(),
});

export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    // The success page polls this route while Pesapal settles, and a shopper
    // may check out more than once in a 15-minute window, so "moderate" (20
    // per 15 min) is too tight for a status poll.
    if (session?.user?.id) {
      await rateLimitByUser(
        request,
        session.user.id,
        "payments:pesapal-verify",
        "lenient",
        session.user.role,
      );
    } else if (cartSessionId) {
      await rateLimitBySession(
        request,
        cartSessionId,
        "payments:pesapal-verify",
        "lenient",
      );
    } else {
      await rateLimitByIP(request, "lenient");
    }

    const body = await validateBody(request, PesapalVerifySchema);
    const orderTrackingId = String(body?.orderTrackingId || "").trim();
    const merchantReference = String(body?.merchantReference || "").trim();
    if (orderTrackingId.length > 100 || merchantReference.length > 100) {
      throw new ValidationError("Invalid Pesapal reference");
    }
    // Pesapal appends OrderTrackingId to the callback, but our own callback URL
    // carries only the merchant reference, so either identifier locates the
    // order (the tracking id is then read back from the order itself).
    if (!orderTrackingId && !merchantReference) {
      throw new ValidationError("Pesapal order tracking ID is required");
    }

    // Vendor→platform payments (boosts, subscriptions) share the gateway;
    // their prefix-marked merchant references never exist on an Order.
    if (isPlatformPaymentReference(merchantReference)) {
      const platformPayment =
        await findPlatformPaymentByReference(merchantReference);
      if (!platformPayment) {
        throw new ValidationError("Unknown Pesapal reference");
      }
      const settings = await getSettings();
      const { paid } = await verifyPlatformPayment(platformPayment, settings);
      return NextResponse.json({
        success: true,
        data: { platformPayment: true, paid },
      });
    }

    const orderQuery: Record<string, unknown> = { paymentMethod: "pesapal" };
    if (orderTrackingId) {
      orderQuery.pesapalOrderTrackingId = orderTrackingId;
    } else {
      orderQuery.pesapalMerchantReference = merchantReference;
    }
    if (session?.user?.id) orderQuery.customerId = session.user.id;

    const order = await Order.findOne(orderQuery).select(
      "_id orderNumber pesapalOrderTrackingId pesapalMerchantReference",
    );
    if (!order) {
      throw new ValidationError("Order not found for Pesapal transaction");
    }

    if (
      merchantReference &&
      merchantReference !== order.pesapalMerchantReference
    ) {
      throw new ValidationError("Pesapal merchant reference mismatch");
    }

    const resolvedOrderTrackingId =
      orderTrackingId || String(order.pesapalOrderTrackingId || "");
    if (!resolvedOrderTrackingId) {
      throw new ValidationError("Order not found for Pesapal transaction");
    }

    const settings = await getSettings();
    const resolved = resolvePesapalCredentials(settings.payment?.pesapal);
    const creds = getPesapalCredentials(resolved);
    const transaction = await getPesapalTransactionStatus({
      creds,
      orderTrackingId: resolvedOrderTrackingId,
    });

    if (transaction.merchant_reference !== order.pesapalMerchantReference) {
      throw new ValidationError("Pesapal merchant reference mismatch");
    }

    const status = getPesapalTransactionState(transaction);
    if (status === "reversed") {
      // The shopper can land here after a reversal too — walk the capture back
      // instead of reporting a status nobody acts on.
      await reversePesapalOrder({
        orderTrackingId: resolvedOrderTrackingId,
        settings,
      });
    }
    if (status !== "completed") {
      return NextResponse.json({
        success: true,
        data: {
          status,
          orderId: String(order._id),
          orderNumber: order.orderNumber,
        },
      });
    }

    const result = await finalizePesapalOrder({
      orderTrackingId: resolvedOrderTrackingId,
      merchantReference: merchantReference || undefined,
      transaction,
      settings,
      sessionUserId: session?.user?.id,
      cartSessionId,
      customerEmail: session?.user?.email,
    });

    return NextResponse.json({
      success: true,
      data: {
        status,
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        alreadyPaid: result.alreadyPaid,
      },
    });
  },
);
