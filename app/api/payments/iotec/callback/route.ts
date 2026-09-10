import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  getIotecCredentials,
  getIotecTransactionState,
  getIotecTransactionStatus,
} from "@/lib/payments/iotec";
import { finalizeIotecOrder } from "@/lib/payments/iotec-orders";
import { resolveIotecCredentials } from "@/lib/settings/credentials";
import { isPlatformPaymentReference } from "@/models/platformPayment.model";
import {
  findPlatformPaymentByReference,
  verifyPlatformPayment,
} from "@/lib/payments/platform-payments";
import { z } from "zod";

type IotecCallbackPayload = {
  id?: string;
  transactionId?: string;
  externalId?: string;
  status?: string;
};

function readField(value: unknown): string | undefined {
  const str = String(value ?? "").trim();
  return str.length ? str : undefined;
}

async function readCallbackPayload(
  request: NextRequest,
): Promise<IotecCallbackPayload> {
  const params = request.nextUrl.searchParams;
  const queryPayload: IotecCallbackPayload = {
    id: readField(params.get("id")),
    transactionId: readField(params.get("transactionId")),
    externalId: readField(params.get("externalId")),
    status: readField(params.get("status")),
  };

  try {
    const body = CallbackBodySchema.parse(await request.json()) as IotecCallbackPayload;
    return {
      id: readField(body?.id) ?? queryPayload.id,
      transactionId: readField(body?.transactionId) ?? queryPayload.transactionId,
      externalId: readField(body?.externalId) ?? queryPayload.externalId,
      status: readField(body?.status) ?? queryPayload.status,
    };
  } catch {
    return queryPayload;
  }
}

async function handleIotecCallback(request: NextRequest) {
  const payload = await readCallbackPayload(request);
  const transactionId = payload.id || payload.transactionId;

  if (!transactionId) {
    return NextResponse.json(
      { success: false, message: "Missing transaction id" },
      { status: 400 },
    );
  }

  try {
    await connectDB();

    // Vendor→platform payments (boosts, subscriptions) use this callback too;
    // their externalId is our prefix-marked reference and never exists on an
    // Order, so dispatch before the order-reference gate below 500s them into
    // ioTec's retry loop.
    if (payload.externalId && isPlatformPaymentReference(payload.externalId)) {
      const platformPayment = await findPlatformPaymentByReference(
        payload.externalId,
      );
      if (!platformPayment) {
        console.error(
          "ioTec callback for an unknown platform reference:",
          payload.externalId,
        );
        return NextResponse.json(
          { success: false, message: "Unknown transaction" },
          { status: 500 },
        );
      }
      const settings = await getSettings();
      // Re-fetches the authoritative status by externalId before finalizing.
      await verifyPlatformPayment(platformPayment, settings);
      return NextResponse.json({ success: true });
    }

    // The endpoint is public, so confirm the reference is one we issued before
    // spending a token + status round trip at ioTec. A 500 lets ioTec retry,
    // which covers the window between the collection being accepted and the
    // transaction id landing on the order.
    const known = await Order.exists({
      paymentMethod: "iotec",
      ...(payload.externalId
        ? {
            $or: [
              { iotecTransactionId: transactionId },
              { iotecExternalId: payload.externalId },
            ],
          }
        : { iotecTransactionId: transactionId }),
    });
    if (!known) {
      console.error("ioTec callback for an unknown transaction:", transactionId);
      return NextResponse.json(
        { success: false, message: "Unknown transaction" },
        { status: 500 },
      );
    }

    const settings = await getSettings();
    const resolved = resolveIotecCredentials(settings.payment?.iotec);
    const creds = getIotecCredentials(resolved);

    // Never trust the callback body — re-fetch the authoritative status.
    const transaction = await getIotecTransactionStatus({
      creds,
      transactionId,
    });

    if (getIotecTransactionState(transaction) === "completed") {
      await finalizeIotecOrder({
        transactionId,
        externalId: payload.externalId,
        transaction,
        settings,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to process ioTec callback:", error);
    return NextResponse.json(
      { success: false, message: "Failed to process callback" },
      { status: 500 },
    );
  }
}

// Server-to-server callback: only "is this a JSON object" is checked here,
// the fields are read defensively below and the signature/verify step decides.
const CallbackBodySchema = z.object({}).loose();

export const GET = handleIotecCallback;
export const POST = handleIotecCallback;
