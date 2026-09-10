import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import {
  getPaystackCredentials,
  type PaystackTransaction,
  verifyPaystackTransaction,
  verifyPaystackWebhookSignature,
} from "@/lib/payments/paystack";
import { finalizePaystackOrder } from "@/lib/payments/paystack-orders";
import {
  readPaystackRefund,
  reconcileGatewayRefundReading,
  reverseFailedGatewayRefund,
} from "@/lib/orders/order-refund-sync";
import { isPlatformPaymentReference } from "@/models/platformPayment.model";
import {
  findPlatformPaymentByReference,
  verifyPlatformPayment,
} from "@/lib/payments/platform-payments";

/** What a `refund.*` event carries. Nothing like a transaction payload. */
type PaystackRefundPayload = {
  id?: unknown;
  status?: string;
  amount?: number;
  currency?: string;
  transaction_reference?: string;
  transaction?: { id?: unknown; reference?: string } | null;
};

type PaystackWebhookPayload = {
  event?: string;
  data?: PaystackTransaction & PaystackRefundPayload;
};

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing Paystack signature" },
      { status: 400 },
    );
  }

  await connectDB();
  const settings = await getSettings();
  const paystack = settings.payment?.paystack;
  const creds = getPaystackCredentials({
    publicKey: paystack?.publicKey,
    secretKey: paystack?.secretKey,
  });

  const isValidSignature = verifyPaystackWebhookSignature({
    body,
    signature,
    secretKey: creds.secretKey,
  });

  if (!isValidSignature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: PaystackWebhookPayload;
  try {
    event = JSON.parse(body) as PaystackWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // A refund pressed in the Paystack dashboard, or one Storify raised that
  // the bank later rejected. Neither reached the books before this: the order
  // stayed fully paid and the vendor was still paid out for a sale the shopper
  // had their money back for.
  if (event.event?.startsWith("refund.") && event.data) {
    try {
      const refund = event.data as PaystackRefundPayload;
      if (event.event === "refund.failed" && refund.id) {
        await reverseFailedGatewayRefund(String(refund.id));
      } else {
        await reconcileGatewayRefundReading(readPaystackRefund(refund));
      }
    } catch (error) {
      // 5xx so Paystack retries: a refund the books never learned about is
      // exactly the failure this handler exists to stop.
      console.error("Failed to process Paystack refund webhook:", error);
      return NextResponse.json(
        { error: "Failed to process webhook" },
        { status: 500 },
      );
    }
    return NextResponse.json({ received: true });
  }

  if (event.event === "charge.success" && event.data?.reference) {
    try {
      // Vendor→platform payments (boosts, subscriptions) share this webhook;
      // their prefix-marked references never match an Order. The verify path
      // re-fetches the authoritative transaction, keeping the same
      // never-trust-the-webhook-body convention as the order flow.
      if (isPlatformPaymentReference(event.data.reference)) {
        const platformPayment = await findPlatformPaymentByReference(
          event.data.reference,
        );
        if (platformPayment) {
          await verifyPlatformPayment(platformPayment, settings);
        } else {
          console.error(
            "Paystack webhook for unknown platform reference:",
            event.data.reference,
          );
        }
        return NextResponse.json({ received: true });
      }
      const transaction = await verifyPaystackTransaction({
        creds,
        reference: event.data.reference,
      });
      await finalizePaystackOrder({
        reference: event.data.reference,
        transaction,
        settings,
        customerEmail: transaction.customer?.email,
      });
    } catch (error) {
      // Return 5xx so Paystack retries the webhook: swallowing a transient DB
      // failure here (after signature verification) left the order pending
      // forever unless the customer's client-side /verify call happened to run.
      console.error("Failed to finalize Paystack webhook transaction:", error);
      return NextResponse.json(
        { error: "Failed to process webhook" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ received: true });
}
