import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Shipment } from "@/models/shipment.model";
import { getSettings } from "@/models/settings.model";
import {
  acquireWebhookLease,
  completeWebhookLease,
  failWebhookLease,
} from "@/lib/payments/webhook-event-lease";
import { carrierAdapter } from "@/lib/shipping/carriers/registry";
import { enqueueShipmentJob } from "@/lib/shipping/carriers/shipment-worker";
import { carrierWebhookSecretMatches } from "@/lib/shipping/carriers/webhook-secret";

export const runtime = "nodejs";

/**
 * Shippo tracking + transaction callbacks.
 *
 * Shippo documents no HMAC signature, so origin is established in three layers,
 * none of which is sufficient alone:
 *
 *  1. The secret in the URL path, compared as a sha256 digest in constant time.
 *  2. We never trust the body. Only the object id and the `test` flag are read;
 *     the worker then re-fetches the authoritative state from Shippo with OUR
 *     token. A forger who obtains the URL therefore achieves nothing beyond
 *     making us poll our own account.
 *  3. The event must map to a shipment we own, in the matching mode — a live
 *     event may not touch a test parcel, or the reverse.
 *
 * Shippo requires a 2XX within three seconds and retries only twice, so the
 * handler does nothing inline beyond leasing and enqueueing.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ secret: string }> },
) {
  const { secret } = await context.params;

  await connectDB();
  const settings = await getSettings();
  const storedHash = settings.shipping?.carriers?.shippo?.webhookSecretHash;

  if (!storedHash || !carrierWebhookSecretMatches(secret, storedHash)) {
    return NextResponse.json({ received: false }, { status: 401 });
  }

  const rawBody = await request.text();
  const envelope = carrierAdapter("shippo").parseWebhook({
    rawBody,
    headers: request.headers,
    url: new URL(request.url),
  });
  if (!envelope) {
    // Not a shape we recognise. 200 rather than 4xx: Shippo would otherwise
    // retry a payload we will never understand.
    return NextResponse.json({ received: true, ignored: true });
  }

  const acquired = await acquireWebhookLease({
    provider: "shippo",
    eventId: envelope.eventId,
    type: envelope.type,
    objectId: envelope.objectId ?? null,
  });
  if (!acquired) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    const identifiers: Record<string, unknown>[] = [];
    if (envelope.transactionId) {
      identifiers.push({ providerTransactionId: envelope.transactionId });
    }
    if (envelope.trackingNumber) {
      identifiers.push({ trackingNumber: envelope.trackingNumber });
    }

    // Nothing that names a parcel — a batch or account-level event, which
    // Shippo also delivers here. MongoDB rejects an empty `$or`, so this used
    // to throw, answer 500, and burn both of Shippo's retries on a payload
    // there was never anything to do with.
    if (identifiers.length === 0) {
      await completeWebhookLease("shippo", envelope.eventId);
      return NextResponse.json({ received: true, unmatched: true });
    }

    const shipment = await Shipment.findOne({
      provider: "shippo",
      $or: identifiers,
    })
      .select("_id orderId subOrderId vendorId providerMode")
      .lean();

    if (!shipment) {
      await completeWebhookLease("shippo", envelope.eventId);
      return NextResponse.json({ received: true, unmatched: true });
    }

    // A test label and a live one look identical everywhere else; crossing the
    // streams here would let a sandbox event mark a real parcel delivered.
    const expectedMode = envelope.test ? "test" : "live";
    if (shipment.providerMode && shipment.providerMode !== expectedMode) {
      await completeWebhookLease("shippo", envelope.eventId);
      return NextResponse.json({ received: true, modeMismatch: true });
    }

    await enqueueShipmentJob({
      orderId: shipment.orderId,
      subOrderId: shipment.subOrderId,
      vendorId: shipment.vendorId,
      shipmentId: shipment._id,
      kind: "sync_tracking",
      provider: "shippo",
    });

    await completeWebhookLease("shippo", envelope.eventId);
    return NextResponse.json({ received: true });
  } catch (error) {
    await failWebhookLease("shippo", envelope.eventId, error);
    // 500 so Shippo retries — the lease is released, so the retry can proceed.
    return NextResponse.json({ received: false }, { status: 500 });
  }
}
