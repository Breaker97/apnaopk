import { NextResponse } from "next/server";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  getMtnMomoCredentials,
  getMtnMomoFailureReason,
  getMtnMomoRequestToPayStatus,
  getMtnMomoTransactionState,
  MtnMomoApiError,
} from "@/lib/payments/mtn-momo";
import { finalizeMtnMomoOrder } from "@/lib/payments/mtn-momo-orders";
import { resolveMtnMomoCredentials } from "@/lib/settings/credentials";
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

const MtnMomoVerifySchema = z.object({
  referenceId: z.string().max(500).optional(),
});

export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    // The payer has to find their phone and type a PIN, so the success page
    // polls this route for minutes. "moderate" (20 per 15 min) would cut that
    // short with a 429 the client reads as a failed payment.
    if (session?.user?.id) {
      await rateLimitByUser(
        request,
        session.user.id,
        "payments:mtn-momo-verify",
        "lenient",
        session.user.role,
      );
    } else if (cartSessionId) {
      await rateLimitBySession(
        request,
        cartSessionId,
        "payments:mtn-momo-verify",
        "lenient",
      );
    } else {
      await rateLimitByIP(request, "lenient");
    }

    const body = await validateBody(request, MtnMomoVerifySchema);
    const referenceId = String(body?.referenceId || "").trim();
    if (referenceId.length > 100) {
      throw new ValidationError("Invalid MTN MoMo reference");
    }
    if (!referenceId) {
      throw new ValidationError("MTN MoMo reference ID is required");
    }

    // Vendor→platform payments (boosts, subscriptions) share the gateway;
    // their prefix-marked references never exist on an Order.
    if (isPlatformPaymentReference(referenceId)) {
      const platformPayment = await findPlatformPaymentByReference(referenceId);
      if (!platformPayment) {
        throw new ValidationError("Unknown MTN MoMo reference");
      }
      const settings = await getSettings();
      const { paid } = await verifyPlatformPayment(platformPayment, settings);
      return NextResponse.json({
        success: true,
        data: { platformPayment: true, paid },
      });
    }

    const orderQuery: Record<string, unknown> = {
      paymentMethod: "mtn_momo",
      mtnMomoReferenceId: referenceId,
    };
    if (session?.user?.id) orderQuery.customerId = session.user.id;

    const order = await Order.findOne(orderQuery).select("_id orderNumber");
    if (!order) {
      throw new ValidationError("Order not found for MTN MoMo transaction");
    }

    const settings = await getSettings();
    const resolved = resolveMtnMomoCredentials(settings.payment?.mtn_momo);
    const creds = getMtnMomoCredentials(resolved);

    let transaction;
    try {
      transaction = await getMtnMomoRequestToPayStatus({
        creds,
        referenceId,
      });
    } catch (err) {
      // The status endpoint can briefly 404 right after the 202 while the
      // platform registers the request. On a polling path that is "not
      // finished yet", never "failed" — the next poll answers.
      if (err instanceof MtnMomoApiError && err.httpStatus === 404) {
        return NextResponse.json({
          success: true,
          data: {
            status: "pending",
            orderId: String(order._id),
            orderNumber: order.orderNumber,
          },
        });
      }
      throw err;
    }

    const state = getMtnMomoTransactionState(transaction);
    if (state !== "completed") {
      return NextResponse.json({
        success: true,
        data: {
          status: state,
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          // The bare code (APPROVAL_REJECTED, EXPIRED, NOT_ENOUGH_FUNDS…) so
          // the client can say why instead of a generic "failed".
          ...(state === "failed"
            ? { reason: getMtnMomoFailureReason(transaction) }
            : {}),
        },
      });
    }

    const result = await finalizeMtnMomoOrder({
      referenceId,
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
