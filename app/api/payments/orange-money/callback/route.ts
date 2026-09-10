import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
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
import { z } from "zod";

type OrangeMoneyNotification = {
  order_id?: string;
  status?: string;
  notif_token?: string;
  txnid?: string;
  amount?: number | string;
  currency?: string;
};

function readField(value: unknown): string | undefined {
  const str = String(value ?? "").trim();
  // Orange's identifiers are short; anything longer is not one of ours and is
  // not worth carrying into a database query.
  return str.length && str.length <= 100 ? str : undefined;
}

async function readNotification(
  request: NextRequest,
): Promise<OrangeMoneyNotification> {
  const params = request.nextUrl.searchParams;
  const fromQuery: OrangeMoneyNotification = {
    order_id: readField(params.get("order_id")),
    status: readField(params.get("status")),
    notif_token: readField(params.get("notif_token")),
    txnid: readField(params.get("txnid")),
    amount: params.get("amount") ?? undefined,
    currency: readField(params.get("currency")),
  };

  try {
    const body = CallbackBodySchema.parse(await request.json()) as OrangeMoneyNotification;
    return {
      order_id: readField(body?.order_id) ?? fromQuery.order_id,
      status: readField(body?.status) ?? fromQuery.status,
      notif_token: readField(body?.notif_token) ?? fromQuery.notif_token,
      txnid: readField(body?.txnid) ?? fromQuery.txnid,
      amount: body?.amount ?? fromQuery.amount,
      currency: readField(body?.currency) ?? fromQuery.currency,
    };
  } catch {
    return fromQuery;
  }
}

/**
 * Constant-time comparison of the notification's token against the one we
 * stored.
 *
 * Hashing both sides first keeps the buffers the same length, so
 * `timingSafeEqual` never throws on a wrong-length candidate — which would
 * itself leak the length. Same shape as `carrierWebhookSecretMatches`.
 */
function notifTokenMatches(
  candidate: string | null | undefined,
  stored: string | null | undefined,
): boolean {
  if (!candidate || !stored) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(stored).digest();
  return timingSafeEqual(a, b);
}

/**
 * Orange Money's server-to-server notification.
 *
 * Orange signs nothing, so authenticity is established in layers: the reference
 * must be one we issued, the `notif_token` must match the one Orange handed us
 * when the payment was created, and — the only real authority — the status is
 * re-fetched from Orange before any money is recognised.
 */
async function handleOrangeMoneyCallback(request: NextRequest) {
  const payload = await readNotification(request);
  const orderId = payload.order_id;
  const status = String(payload.status || "").toUpperCase();

  if (!orderId || !status) {
    return NextResponse.json(
      { success: false, message: "Missing order id or status" },
      { status: 400 },
    );
  }

  // INITIATED/PENDING carry no money and need no action. Acknowledging them
  // before any lookup keeps them out of the retry loop and means the only
  // notification that could race the token write is one we already ignore.
  if (status === "INITIATED" || status === "PENDING") {
    return NextResponse.json({ success: true });
  }

  try {
    await connectDB();

    // Vendor→platform payments (boosts, subscriptions) use this callback too;
    // their order_id is our prefix-marked reference and never exists on an
    // Order, so dispatch before the order gate below 500s them into Orange's
    // retry loop.
    if (isPlatformPaymentReference(orderId)) {
      const platformPayment = await findPlatformPaymentByReference(orderId);
      if (!platformPayment) {
        console.error(
          "Orange Money callback for an unknown platform reference:",
          orderId,
        );
        return NextResponse.json(
          { success: false, message: "Unknown transaction" },
          { status: 500 },
        );
      }
      const settings = await getSettings();
      await verifyPlatformPayment(platformPayment, settings, {
        orangeMoneyNotifToken: payload.notif_token,
      });
      return NextResponse.json({ success: true });
    }

    // The endpoint is public, so confirm the reference is one we issued before
    // spending a token + status round trip at Orange.
    const order = await Order.findOne({
      paymentMethod: "orange_money",
      orangeMoneyOrderId: orderId,
    }).select("orangeMoneyPayToken orangeMoneyNotifToken total preorderOutstandingAmount");

    if (!order) {
      console.error("Orange Money callback for an unknown order:", orderId);
      return NextResponse.json(
        { success: false, message: "Unknown transaction" },
        { status: 500 },
      );
    }

    // A stored token we do not have means we cannot answer for this payment —
    // and "cannot answer" must never be recorded as "not paid". 500 so Orange
    // presents it again, and so the client-side poll can resolve it meanwhile.
    if (!order.orangeMoneyNotifToken || !order.orangeMoneyPayToken) {
      console.error(
        "Orange Money callback arrived before the payment session was stored:",
        orderId,
      );
      return NextResponse.json(
        { success: false, message: "Payment session not ready" },
        { status: 500 },
      );
    }

    // A wrong token is terminal, not transient: retrying cannot fix it, so
    // acknowledge rather than feeding a retry loop.
    if (!notifTokenMatches(payload.notif_token, order.orangeMoneyNotifToken)) {
      console.error(
        "Orange Money callback with an invalid notif token:",
        orderId,
      );
      return NextResponse.json({ success: true });
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

    // Never trust the callback body — re-fetch the authoritative status. The
    // call carries our own order id, pay token and expected amount, so a
    // SUCCESS answer confirms the amount as well as the state.
    const transaction = await getOrangeMoneyTransactionStatus({
      creds,
      orderId,
      amount: expectedAmount,
      payToken: order.orangeMoneyPayToken,
    });

    if (getOrangeMoneyTransactionState(transaction) === "completed") {
      await finalizeOrangeMoneyOrder({
        orderId,
        transaction,
        notification: payload,
        mode: creds.mode,
        settings,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to process Orange Money callback:", error);
    return NextResponse.json(
      { success: false, message: "Failed to process callback" },
      { status: 500 },
    );
  }
}

// Server-to-server callback: only "is this a JSON object" is checked here,
// the fields are read defensively below and the signature/verify step decides.
const CallbackBodySchema = z.object({}).loose();

export const GET = handleOrangeMoneyCallback;
export const POST = handleOrangeMoneyCallback;
