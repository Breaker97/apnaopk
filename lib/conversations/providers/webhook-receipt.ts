import {
  MessagingWebhookReceipt,
  type IMessagingWebhookReceipt,
} from "@/models/messaging-webhook-receipt.model";

/**
 * Idempotency for a provider webhook, shared by every surface that has one.
 *
 * Both Meta and Telegram redeliver an event until they get a 2xx, so a receipt
 * row is what stops the same message being ingested twice. The subtlety is what
 * a receipt that already exists actually means:
 *
 * - `processed` — genuinely handled; drop the redelivery.
 * - `processing` and recent — another worker still has it; drop the redelivery.
 * - `processing` and stale, or `failed` — the previous attempt died partway.
 *   This MUST be re-claimed, not dropped.
 *
 * Telegram used to treat every duplicate key as "already handled", so a
 * transient fault after the receipt row was written (a Mongo blip, a provider
 * profile lookup timing out) turned into permanent message loss: the row stayed
 * `processing`, the route answered 500, and every Telegram retry hit the unique
 * index and was discarded. Sharing this claim is what keeps the two webhooks
 * from drifting apart again.
 */

/** A receipt left `processing` more recently than this is assumed in flight. */
const IN_FLIGHT_MS = 5 * 60 * 1000;

/**
 * Whether an existing receipt means this redelivery should be discarded.
 *
 * Exported because it is the whole idempotency policy: everything else here is
 * database plumbing. `failed`, and `processing` that has gone stale, both mean
 * the previous attempt did NOT finish and the event must be reprocessed.
 */
export function shouldDropRedelivery(
  existing: Pick<IMessagingWebhookReceipt, "status" | "updatedAt"> | null,
  now = Date.now(),
) {
  if (!existing) return false;
  if (existing.status === "processed") return true;
  return (
    existing.status === "processing" &&
    now - existing.updatedAt.getTime() < IN_FLIGHT_MS
  );
}

type WebhookReceiptClaim =
  | { duplicate: true; receipt?: undefined }
  | { duplicate: false; receipt: IMessagingWebhookReceipt };

export async function claimWebhookReceipt(params: {
  provider: "meta" | "telegram";
  eventKey: string;
  payloadHash: string;
}): Promise<WebhookReceiptClaim> {
  try {
    return {
      duplicate: false,
      receipt: await MessagingWebhookReceipt.create({
        provider: params.provider,
        eventKey: params.eventKey,
        payloadHash: params.payloadHash,
        status: "processing",
      }),
    };
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      (error as { code?: number }).code !== 11000
    ) {
      throw error;
    }
  }

  const key = { provider: params.provider, eventKey: params.eventKey };
  const existing = await MessagingWebhookReceipt.findOne(key);
  if (shouldDropRedelivery(existing)) return { duplicate: true };
  const receipt = await MessagingWebhookReceipt.findOneAndUpdate(
    key,
    {
      $set: { status: "processing", payloadHash: params.payloadHash },
      // `$set: { lastError: undefined }` is dropped by Mongoose, so the stale
      // error from the failed attempt survived the retry.
      $unset: { lastError: "" },
      $inc: { attempts: 1 },
    },
    { new: true },
  );
  if (!receipt) throw new Error("Unable to acquire webhook receipt");
  return { duplicate: false, receipt };
}

export async function markWebhookReceiptProcessed(
  receipt: IMessagingWebhookReceipt,
) {
  await MessagingWebhookReceipt.updateOne(
    { _id: receipt._id },
    {
      $set: { status: "processed", processedAt: new Date() },
      $unset: { lastError: "" },
    },
  );
}

export async function markWebhookReceiptFailed(
  receipt: IMessagingWebhookReceipt,
  error: unknown,
) {
  await MessagingWebhookReceipt.updateOne(
    { _id: receipt._id },
    {
      $set: {
        status: "failed",
        lastError:
          error instanceof Error
            ? error.message.slice(0, 2000)
            : "Unknown error",
      },
    },
  );
}
