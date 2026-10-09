import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Shipment } from "@/models/shipment.model";
import { getSettings } from "@/models/settings.model";
import { resolveShiprocketCredentials } from "@/lib/settings/credentials";
import {
  acquireWebhookLease,
  completeWebhookLease,
  failWebhookLease,
} from "@/lib/payments/webhook-event-lease";
import { carrierAdapter } from "@/lib/shipping/carriers/registry";
import { enqueueShipmentJob } from "@/lib/shipping/carriers/shipment-worker";
import { carrierWebhookTokenMatches } from "@/lib/shipping/carriers/webhook-secret";

export const runtime = "nodejs";

/**
 * Shiprocket tracking callbacks.
 *
 * Authenticated by the `x-api-key` token the merchant sets in both systems,
 * compared in constant time. Same discipline as the Shippo receiver: the body
 * is only used to identify *which* parcel changed, and the worker re-fetches
 * the authoritative status from Shiprocket before anything is written.
 */
export async function POST(request: NextRequest) {
  await connectDB();
  const settings = await getSettings();
  const { webhookToken } = resolveShiprocketCredentials(
    settings.shipping?.carriers?.shiprocket,
  );

  const presented =
    request.headers.get("x-api-key") || request.headers.get("x-shiprocket-key");
  if (!carrierWebhookTokenMatches(presented, webhookToken)) {
    return NextResponse.json({ received: false }, { status: 401 });
  }

  const rawBody = await request.text();
  const envelope = carrierAdapter("shiprocket").parseWebhook({
    rawBody,
    headers: request.headers,
    url: new URL(request.url),
  });
  if (!envelope) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const acquired = await acquireWebhookLease({
    provider: "shiprocket",
    eventId: envelope.eventId,
    type: envelope.type,
    objectId: envelope.objectId ?? null,
  });
  if (!acquired) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    const shipment = await Shipment.findOne({
      provider: "shiprocket",
      trackingNumber: envelope.trackingNumber,
    })
      .select("_id orderId subOrderId vendorId")
      .lean();

    if (!shipment) {
      await completeWebhookLease("shiprocket", envelope.eventId);
      return NextResponse.json({ received: true, unmatched: true });
    }

    await enqueueShipmentJob({
      orderId: shipment.orderId,
      subOrderId: shipment.subOrderId,
      vendorId: shipment.vendorId,
      shipmentId: shipment._id,
      kind: "sync_tracking",
      provider: "shiprocket",
    });

    await completeWebhookLease("shiprocket", envelope.eventId);
    return NextResponse.json({ received: true });
  } catch (error) {
    await failWebhookLease("shiprocket", envelope.eventId, error);
    return NextResponse.json({ received: false }, { status: 500 });
  }
}
