import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
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
import { z } from "zod";

type PesapalIpnPayload = {
  OrderTrackingId?: string;
  OrderMerchantReference?: string;
  OrderNotificationType?: string;
};

function ipnResponse(payload: PesapalIpnPayload, status: 200 | 500) {
  return NextResponse.json(
    {
      orderNotificationType: payload.OrderNotificationType || "IPNCHANGE",
      orderTrackingId: payload.OrderTrackingId || "",
      orderMerchantReference: payload.OrderMerchantReference || "",
      status,
    },
    { status },
  );
}

async function readIpnPayload(request: NextRequest): Promise<PesapalIpnPayload> {
  const queryPayload: PesapalIpnPayload = {
    OrderTrackingId:
      request.nextUrl.searchParams.get("OrderTrackingId") || undefined,
    OrderMerchantReference:
      request.nextUrl.searchParams.get("OrderMerchantReference") || undefined,
    OrderNotificationType:
      request.nextUrl.searchParams.get("OrderNotificationType") || undefined,
  };
  if (queryPayload.OrderTrackingId) return queryPayload;

  try {
    const body = CallbackBodySchema.parse(await request.json()) as PesapalIpnPayload;
    return { ...queryPayload, ...body };
  } catch {
    return queryPayload;
  }
}

async function handlePesapalIpn(request: NextRequest) {
  const payload = await readIpnPayload(request);
  if (!payload.OrderTrackingId || !payload.OrderMerchantReference) {
    return ipnResponse(payload, 500);
  }

  try {
    await connectDB();

    // Vendor→platform payments (boosts, subscriptions) arrive on this same
    // registered IPN. Their prefix-marked merchant references never exist on
    // an Order, so dispatch them before the order-reference gate — otherwise
    // every platform IPN 500s into Pesapal's retry loop forever.
    if (isPlatformPaymentReference(payload.OrderMerchantReference)) {
      const platformPayment = await findPlatformPaymentByReference(
        payload.OrderMerchantReference,
      );
      if (!platformPayment) {
        console.error(
          "Pesapal IPN for an unknown platform reference:",
          payload.OrderMerchantReference,
        );
        return ipnResponse(payload, 500);
      }
      const settings = await getSettings();
      // Handles completed AND reversed states (a reversal cancels the boost).
      // 200 only once the attempt reached a terminal state — a transient
      // verification failure must keep Pesapal's retry loop alive, exactly
      // like the order branch below.
      //
      // The tracking id is handed over because initiation stores it in a second
      // write that this notification can outrun: without it an attempt that has
      // not recorded its id yet can ask Pesapal nothing, answers "not paid",
      // and would be 200'd — ending the retries on a payment we never granted.
      try {
        await verifyPlatformPayment(platformPayment, settings, {
          pesapalOrderTrackingId: payload.OrderTrackingId,
        });
      } catch (error) {
        console.error("Pesapal platform IPN verification failed:", error);
        return ipnResponse(payload, 500);
      }
      return ipnResponse(payload, 200);
    }

    // The endpoint is public and unsigned, so confirm the reference is one we
    // issued before spending a token + status round trip at Pesapal. A 500
    // makes Pesapal retry, which covers the window between submitting the
    // order request and persisting the order.
    const known = await Order.exists({
      paymentMethod: "pesapal",
      pesapalOrderTrackingId: payload.OrderTrackingId,
      pesapalMerchantReference: payload.OrderMerchantReference,
    });
    if (!known) {
      console.error(
        "Pesapal IPN for an unknown order reference:",
        payload.OrderMerchantReference,
      );
      return ipnResponse(payload, 500);
    }

    const settings = await getSettings();
    const resolved = resolvePesapalCredentials(settings.payment?.pesapal);
    const creds = getPesapalCredentials(resolved);
    const transaction = await getPesapalTransactionStatus({
      creds,
      orderTrackingId: payload.OrderTrackingId,
    });

    if (transaction.merchant_reference !== payload.OrderMerchantReference) {
      throw new Error("Pesapal IPN merchant reference mismatch");
    }

    const state = getPesapalTransactionState(transaction);
    if (state === "completed") {
      await finalizePesapalOrder({
        orderTrackingId: payload.OrderTrackingId,
        merchantReference: payload.OrderMerchantReference,
        transaction,
        settings,
      });
    } else if (state === "reversed") {
      // A reversal can arrive long after the capture IPN, so an order that is
      // already paid has to be walked back rather than left as-is.
      await reversePesapalOrder({
        orderTrackingId: payload.OrderTrackingId,
        settings,
      });
    }

    return ipnResponse(payload, 200);
  } catch (error) {
    console.error("Failed to process Pesapal IPN:", error);
    return ipnResponse(payload, 500);
  }
}

// Server-to-server callback: only "is this a JSON object" is checked here,
// the fields are read defensively below and the signature/verify step decides.
const CallbackBodySchema = z.object({}).loose();

export const GET = handlePesapalIpn;
export const POST = handlePesapalIpn;
