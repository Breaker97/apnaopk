import { NextResponse } from "next/server";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  getOrangeMoneyCredentials,
  getOrangeMoneyTransactionState,
  getOrangeMoneyTransactionStatus,
} from "@/lib/payments/orange-money";
import { finalizeOrangeMoneyOrder } from "@/lib/payments/orange-money-orders";
import { resolveOrangeMoneyCredentials } from "@/lib/settings/credentials";
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

const OrangeMoneyVerifySchema = z.object({
  orderId: z.string().max(500).optional(),
});

export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    // Orange payers validate with an OTP they generate over USSD, so the
    // success page polls this route ~30 times before giving up. "moderate"
    // (20 per 15 min) would cut that short with a 429 the client reads as a
    // failed payment.
    if (session?.user?.id) {
      await rateLimitByUser(
        request,
        session.user.id,
        "payments:orange-money-verify",
        "lenient",
        session.user.role,
      );
    } else if (cartSessionId) {
      await rateLimitBySession(
        request,
        cartSessionId,
        "payments:orange-money-verify",
        "lenient",
      );
    } else {
      await rateLimitByIP(request, "lenient");
    }

    const body = await validateBody(request, OrangeMoneyVerifySchema);
    const orderId = String(body?.orderId || "").trim();
    if (orderId.length > 100) {
      throw new ValidationError("Invalid Orange Money reference");
    }
    if (!orderId) {
      throw new ValidationError("Orange Money order ID is required");
    }

    // Vendor→platform payments (boosts, subscriptions) share the gateway;
    // their prefix-marked references never exist on an Order.
    if (isPlatformPaymentReference(orderId)) {
      const platformPayment = await findPlatformPaymentByReference(orderId);
      if (!platformPayment) {
        throw new ValidationError("Unknown Orange Money reference");
      }
      const settings = await getSettings();
      const { paid } = await verifyPlatformPayment(platformPayment, settings);
      return NextResponse.json({
        success: true,
        data: { platformPayment: true, paid },
      });
    }

    const orderQuery: Record<string, unknown> = {
      paymentMethod: "orange_money",
      orangeMoneyOrderId: orderId,
    };
    if (session?.user?.id) orderQuery.customerId = session.user.id;

    const order = await Order.findOne(orderQuery).select(
      "_id orderNumber orangeMoneyPayToken total preorderOutstandingAmount",
    );
    if (!order) {
      throw new ValidationError("Order not found for Orange Money transaction");
    }

    // Written in the same request that created the payment session, so its
    // absence means the session never completed — the order can never be paid.
    if (!order.orangeMoneyPayToken) {
      throw new ValidationError(
        "Orange Money payment session is incomplete. Please start the payment again.",
      );
    }

    const settings = await getSettings();
    const resolved = resolveOrangeMoneyCredentials(
      settings.payment?.orange_money,
    );
    const creds = getOrangeMoneyCredentials(resolved);

    const expectedAmount = Math.max(
      0,
      Number(order.total || 0) - Number(order.preorderOutstandingAmount || 0),
    );

    const transaction = await getOrangeMoneyTransactionStatus({
      creds,
      orderId,
      amount: expectedAmount,
      payToken: order.orangeMoneyPayToken,
    });

    const state = getOrangeMoneyTransactionState(transaction);
    if (state !== "completed") {
      return NextResponse.json({
        success: true,
        data: {
          status: state,
          orderId: String(order._id),
          orderNumber: order.orderNumber,
        },
      });
    }

    const result = await finalizeOrangeMoneyOrder({
      orderId,
      transaction,
      mode: creds.mode,
      settings,
      sessionUserId: session?.user?.id,
      cartSessionId,
      customerEmail: session?.user?.email,
    });

    return NextResponse.json({
      success: true,
      data: {
        status: "completed",
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        alreadyPaid: result.alreadyPaid,
      },
    });
  },
);
