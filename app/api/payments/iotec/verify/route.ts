import { NextResponse } from "next/server";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  getIotecCredentials,
  getIotecTransactionState,
  getIotecTransactionStatus,
  getIotecTransactionStatusByExternalId,
} from "@/lib/payments/iotec";
import { finalizeIotecOrder } from "@/lib/payments/iotec-orders";
import { resolveIotecCredentials } from "@/lib/settings/credentials";
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

const IotecVerifySchema = z.object({
  transactionId: z.string().max(500).optional(),
  externalId: z.string().max(500).optional(),
});

export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    // Mobile-money payers approve on their phone, so the success page polls
    // this route ~30 times before giving up. "moderate" (20 per 15 min) would
    // cut that short with a 429 the client reads as a failed payment.
    if (session?.user?.id) {
      await rateLimitByUser(
        request,
        session.user.id,
        "payments:iotec-verify",
        "lenient",
        session.user.role,
      );
    } else if (cartSessionId) {
      await rateLimitBySession(
        request,
        cartSessionId,
        "payments:iotec-verify",
        "lenient",
      );
    } else {
      await rateLimitByIP(request, "lenient");
    }

    const body = await validateBody(request, IotecVerifySchema);
    const transactionId = String(body?.transactionId || "").trim();
    const externalId = String(body?.externalId || "").trim();
    if (transactionId.length > 100 || externalId.length > 100) {
      throw new ValidationError("Invalid ioTec reference");
    }
    // Card payments redirect back with only the external reference (the
    // transaction id is not in the return URL), so either identifier works.
    if (!transactionId && !externalId) {
      throw new ValidationError("ioTec transaction ID is required");
    }

    // Vendor→platform payments (boosts, subscriptions) share the gateway;
    // their prefix-marked external references never exist on an Order.
    if (externalId && isPlatformPaymentReference(externalId)) {
      const platformPayment = await findPlatformPaymentByReference(externalId);
      if (!platformPayment) {
        throw new ValidationError("Unknown ioTec reference");
      }
      const settings = await getSettings();
      const { paid } = await verifyPlatformPayment(platformPayment, settings);
      return NextResponse.json({
        success: true,
        data: { platformPayment: true, paid },
      });
    }

    const orderQuery: Record<string, unknown> = { paymentMethod: "iotec" };
    if (transactionId) {
      orderQuery.iotecTransactionId = transactionId;
    } else {
      orderQuery.iotecExternalId = externalId;
    }
    if (session?.user?.id) orderQuery.customerId = session.user.id;

    const order = await Order.findOne(orderQuery).select(
      "_id orderNumber iotecTransactionId iotecExternalId",
    );
    if (!order) {
      throw new ValidationError("Order not found for ioTec transaction");
    }

    if (
      externalId &&
      order.iotecExternalId &&
      externalId !== order.iotecExternalId
    ) {
      throw new ValidationError("ioTec reference mismatch");
    }

    const settings = await getSettings();
    const resolved = resolveIotecCredentials(settings.payment?.iotec);
    const creds = getIotecCredentials(resolved);
    const transaction = transactionId
      ? await getIotecTransactionStatus({ creds, transactionId })
      : await getIotecTransactionStatusByExternalId({ creds, externalId });

    // The order's stored transaction id is authoritative; a status response
    // for a different collection must not finalize this order.
    if (
      transaction.id &&
      order.iotecTransactionId &&
      String(transaction.id) !== String(order.iotecTransactionId)
    ) {
      throw new ValidationError("ioTec reference mismatch");
    }
    // Falls back to the id on the status response for the brief window between
    // the collection being accepted and its id landing on the order.
    const resolvedTransactionId =
      transactionId || String(order.iotecTransactionId || transaction.id || "");
    if (!resolvedTransactionId) {
      throw new ValidationError("Order not found for ioTec transaction");
    }

    const status = getIotecTransactionState(transaction);
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

    const result = await finalizeIotecOrder({
      transactionId: resolvedTransactionId,
      externalId: externalId || order.iotecExternalId || undefined,
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
