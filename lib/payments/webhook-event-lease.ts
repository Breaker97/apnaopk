import type Stripe from "stripe";
import {
  WebhookEvent,
  type WebhookEventProvider,
} from "@/models/webhookEvent.model";

export const WEBHOOK_LEASE_MS = 60_000;

/** How long a settled event row is kept before the TTL index reaps it. */
export const WEBHOOK_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function webhookLeaseExpiry(now: Date): Date {
  return new Date(now.getTime() + WEBHOOK_LEASE_MS);
}

export function webhookEventExpiry(now: Date): Date {
  return new Date(now.getTime() + WEBHOOK_EVENT_RETENTION_MS);
}

export function webhookLeaseQuery(
  provider: WebhookEventProvider,
  eventId: string,
  now: Date,
) {
  return {
    provider,
    eventId,
    processedAt: null,
    $or: [
      { leaseUntil: null },
      { leaseUntil: { $lte: now } },
    ],
  };
}

/**
 * The provider-neutral shape the lease works on.
 *
 * The helpers used to take a `Stripe.Event` outright, which meant a second
 * provider could not reuse the de-duplication ledger at all — and every
 * webhook needs exactly the same "process this event once" guarantee.
 */
interface WebhookLeaseInput {
  provider: WebhookEventProvider;
  /** Unique per provider. Synthesise one when the provider sends no event id. */
  eventId: string;
  type: string;
  eventCreatedAt?: Date | null;
  /** The provider object the event is about, for operator lookups. */
  objectId?: string | null;
}

function stripeEventObjectId(event: Stripe.Event): string | null {
  const object = event.data?.object as { id?: unknown } | undefined;
  return typeof object?.id === "string" ? object.id : null;
}

export function stripeWebhookLeaseInput(event: Stripe.Event): WebhookLeaseInput {
  return {
    provider: "stripe",
    eventId: event.id,
    type: event.type,
    eventCreatedAt: new Date(event.created * 1000),
    objectId: stripeEventObjectId(event),
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  return (error as { code?: unknown }).code === 11000;
}

export async function acquireWebhookLease(
  input: WebhookLeaseInput,
  now: Date = new Date(),
): Promise<boolean> {
  const { provider, eventId } = input;
  try {
    await WebhookEvent.updateOne(
      { provider, eventId },
      {
        $setOnInsert: {
          provider,
          eventId,
          type: input.type,
          status: "failed",
          eventCreatedAt: input.eventCreatedAt ?? null,
          objectId: input.objectId ?? null,
          attemptCount: 0,
          leaseUntil: null,
          processingStartedAt: null,
          processedAt: null,
          lastError: null,
          expiresAt: null,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  const acquired = await WebhookEvent.findOneAndUpdate(
    webhookLeaseQuery(provider, eventId, now),
    {
      $set: {
        type: input.type,
        status: "processing",
        eventCreatedAt: input.eventCreatedAt ?? null,
        objectId: input.objectId ?? null,
        processingStartedAt: now,
        leaseUntil: webhookLeaseExpiry(now),
        lastError: null,
        // An event that is being retried is no longer settled, so it must not
        // be reaped mid-flight.
        expiresAt: null,
      },
      $inc: { attemptCount: 1 },
    },
    { new: true },
  )
    .select("_id")
    .lean<{ _id: unknown } | null>();

  return Boolean(acquired);
}

export async function completeWebhookLease(
  provider: WebhookEventProvider,
  eventId: string,
  now: Date = new Date(),
): Promise<void> {
  await WebhookEvent.updateOne(
    { provider, eventId, status: "processing" },
    {
      $set: {
        status: "processed",
        processedAt: now,
        leaseUntil: null,
        lastError: null,
        expiresAt: webhookEventExpiry(now),
      },
    },
  );
}

export async function failWebhookLease(
  provider: WebhookEventProvider,
  eventId: string,
  error: unknown,
  now: Date = new Date(),
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await WebhookEvent.updateOne(
    { provider, eventId },
    {
      $set: {
        status: "failed",
        leaseUntil: null,
        lastError: message.slice(0, 2000),
        // Kept longer than a success on purpose: a failed row is the only
        // record an operator has of what went wrong.
        expiresAt: webhookEventExpiry(now),
      },
    },
  );
}
