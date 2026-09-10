import { Types } from "mongoose";
import {
  ChannelConnection,
  Conversation,
  ConversationMessage,
  MessageOutbox,
} from "@/models";
import {
  CHANNEL_CONNECTION_STATUSES,
  type MessageProvider,
} from "@/models/channel-connection.model";
import {
  CONVERSATION_MESSAGE_STATUSES,
} from "@/models/conversation-message.model";
import {
  MessagingDeliveryError,
  providerAdapter,
} from "@/lib/conversations/providers/registry";
import { demoteChannelConnection } from "@/lib/conversations/providers/connection-health";

const MAX_ATTEMPTS = 8;
const LEASE_MS = 60_000;
/**
 * How long one cron invocation keeps claiming work.
 *
 * The route's `maxDuration` is 60s while a single send may block for the
 * provider's full 15s timeout, so a count-only bound (`limit` items) could ask
 * for far more wall-clock than the function is allowed — and a run killed
 * mid-loop leaves its claimed rows leased for another minute. Stopping early
 * keeps every batch inside the budget; the leftovers are claimed by the next
 * minute's run, which is exactly what the queue is for.
 */
const BATCH_BUDGET_MS = 45_000;

export async function queueExternalMessage(params: {
  conversationId: Types.ObjectId;
  messageId: Types.ObjectId;
  channelConnectionId: Types.ObjectId;
  // Every external channel, not a hand-listed pair. Naming two providers here
  // forced Instagram and Telegram through a cast at the call site — the exact
  // silent drift the channel capability table exists to prevent.
  provider: MessageProvider;
}) {
  return MessageOutbox.findOneAndUpdate(
    { messageId: params.messageId },
    {
      $setOnInsert: {
        ...params,
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function claimOutboxItem(messageId?: Types.ObjectId) {
  const now = new Date();
  return MessageOutbox.findOneAndUpdate(
    {
      // Expired processing leases are reclaimed after a worker crash.
      status: { $in: ["pending", "failed", "processing"] },
      ...(messageId ? { messageId } : {}),
      attempts: { $lt: MAX_ATTEMPTS },
      nextAttemptAt: { $lte: now },
      $or: [
        { leaseUntil: { $exists: false } },
        { leaseUntil: null },
        { leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "processing",
        leaseUntil: new Date(now.getTime() + LEASE_MS),
      },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { nextAttemptAt: 1, _id: 1 } },
  );
}

const DEAD_LETTER_AT = new Date("9999-12-31T23:59:59.999Z");
/** Delivered rows are audit noise once the provider has confirmed them. */
const SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Dead-lettered rows stay long enough to be triaged in the failures panel. */
const DEAD_LETTER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function retentionDate(milliseconds: number) {
  return new Date(Date.now() + milliseconds);
}

function retryAt(attempts: number, minimumSeconds = 0) {
  const delaySeconds = Math.max(
    minimumSeconds,
    Math.min(15 * 60, 5 * 2 ** Math.max(0, attempts - 1)),
  );
  return new Date(Date.now() + delaySeconds * 1000);
}

/**
 * Decides what a failed send means, using Meta's structured error rather than
 * its message string: a revoked token, a malformed template and a rate limit
 * all used to be retried eight times identically.
 *
 * Exported for tests — this is the outbox's whole retry policy in one place.
 */
export function classifyOutboxFailure(
  provider: MessageProvider,
  error: unknown,
  attempts: number,
) {
  const message =
    error instanceof Error ? error.message.slice(0, 2000) : "Unknown error";
  // A fault we raised before the provider was contacted already knows whether
  // it can recover, so it is answered here rather than being handed to an
  // adapter that has no idea what it is looking at.
  if (error instanceof MessagingDeliveryError) {
    return {
      message,
      errorCode: error.code,
      demoteConnection: false,
      nextAttemptAt:
        error.permanent || attempts >= MAX_ATTEMPTS
          ? DEAD_LETTER_AT
          : retryAt(attempts),
    };
  }
  const failure = providerAdapter(provider).classify(error);
  // An unrecognised error stays retryable: mistaking an unknown fault for a
  // permanent one would dead-letter a message the provider would have accepted.
  if (!failure) {
    return {
      message,
      errorCode: undefined as string | undefined,
      demoteConnection: false,
      nextAttemptAt:
        attempts >= MAX_ATTEMPTS ? DEAD_LETTER_AT : retryAt(attempts),
    };
  }
  // Permanent failures skip the remaining attempts entirely — the payload,
  // recipient or credential will not become valid by waiting.
  if (failure.permanent) {
    return {
      message,
      errorCode: failure.errorCode,
      demoteConnection: failure.authFailure,
      nextAttemptAt: DEAD_LETTER_AT,
    };
  }
  return {
    message,
    errorCode: failure.errorCode,
    demoteConnection: false,
    nextAttemptAt:
      attempts >= MAX_ATTEMPTS
        ? DEAD_LETTER_AT
        : retryAt(attempts, failure.retryAfterSeconds || 0),
  };
}

/**
 * States a successful send must leave alone rather than overwrite with `sent`.
 *
 * A Messenger/Instagram read watermark matches outbound messages by TIME rather
 * than by provider id, so it can land while this very send is still in flight.
 * Stamping `sent` over it left the message stuck there permanently, because Meta
 * never restates a delivery status it has already reported.
 */
export const SEND_MUST_NOT_DOWNGRADE_FROM = [
  CONVERSATION_MESSAGE_STATUSES.DELIVERED,
  CONVERSATION_MESSAGE_STATUSES.READ,
] as const;

async function processOutboxItem(item: NonNullable<Awaited<ReturnType<typeof claimOutboxItem>>>) {
  try {
    // Fetched WITHOUT a status filter on purpose. Folding "no such connection"
    // and "connection is not active" into one null made both retryable, so a
    // channel the operator had deliberately disconnected still burned eight
    // attempts. They are opposite verdicts and have to be told apart.
    const [conversation, message, connection] = await Promise.all([
      Conversation.findById(item.conversationId),
      ConversationMessage.findById(item.messageId),
      ChannelConnection.findById(item.channelConnectionId),
    ]);
    if (!conversation || !message) {
      throw new MessagingDeliveryError({
        message: "The conversation or message no longer exists",
        code: "message_missing",
        permanent: true,
      });
    }
    if (!connection || connection.status === CHANNEL_CONNECTION_STATUSES.REVOKED) {
      throw new MessagingDeliveryError({
        message: "This channel has been disconnected",
        code: "connection_revoked",
        permanent: true,
      });
    }
    if (connection.status !== CHANNEL_CONNECTION_STATUSES.ACTIVE) {
      // Recoverable: the operator can re-verify the credential, and the
      // failures panel offers a manual retry once they have.
      throw new MessagingDeliveryError({
        message: `The ${connection.provider} channel needs to be reconnected`,
        code: "connection_inactive",
        permanent: false,
      });
    }
    if (
      connection.tokenExpiresAt &&
      connection.tokenExpiresAt.getTime() <= Date.now()
    ) {
      await demoteChannelConnection({
        connectionId: connection._id as Types.ObjectId,
        reason: "The provider access token has expired",
      });
      throw new MessagingDeliveryError({
        message: "The provider access token has expired",
        code: "token_expired",
        permanent: false,
      });
    }
    if (!conversation.externalThreadId) {
      throw new MessagingDeliveryError({
        message: "This conversation has no external recipient",
        code: "recipient_missing",
        permanent: true,
      });
    }
    // Provider-specific send rules (templates, reply windows, media shapes)
    // live in the adapter; the queue only owns leasing, retry and bookkeeping.
    const providerMessageId = await providerAdapter(connection.provider).send({
      connection,
      conversation,
      message,
      recipientId: conversation.externalThreadId,
    });
    await Promise.all([
      MessageOutbox.updateOne(
        { _id: item._id },
        {
          $set: {
            status: "sent",
            providerMessageId,
            expiresAt: retentionDate(SENT_RETENTION_MS),
          },
          $unset: { leaseUntil: "", lastError: "" },
        },
      ),
      ConversationMessage.updateOne({ _id: message._id }, [
        {
          $set: {
            providerMessageId,
            deliveryStatus: {
              $cond: [
                { $in: ["$deliveryStatus", [...SEND_MUST_NOT_DOWNGRADE_FROM]] },
                "$deliveryStatus",
                CONVERSATION_MESSAGE_STATUSES.SENT,
              ],
            },
          },
        },
      ]),
    ]);
    return true;
  } catch (error) {
    const failure = classifyOutboxFailure(
      item.provider,
      error,
      item.attempts,
    );
    const deadLettered = failure.nextAttemptAt === DEAD_LETTER_AT;
    await Promise.all([
      MessageOutbox.updateOne(
        { _id: item._id },
        {
          $set: {
            status: "failed",
            lastError: failure.message,
            nextAttemptAt: failure.nextAttemptAt,
            // Only a terminal row gets a reap date; a row that will be retried
            // must stay until it actually settles.
            ...(deadLettered
              ? { expiresAt: retentionDate(DEAD_LETTER_RETENTION_MS) }
              : {}),
          },
          $unset: { leaseUntil: "", ...(deadLettered ? {} : { expiresAt: "" }) },
        },
      ),
      ConversationMessage.updateOne(
        { _id: item.messageId },
        {
          $set: {
            deliveryStatus: CONVERSATION_MESSAGE_STATUSES.FAILED,
            errorMessage: failure.message,
            ...(failure.errorCode ? { errorCode: failure.errorCode } : {}),
          },
        },
      ),
      // A dead token fails every future send on this connection, so stop
      // presenting it as active, surface the reason to the operator, and — via
      // `demoteChannelConnection` — actually tell them the channel is down.
      ...(failure.demoteConnection
        ? [
            demoteChannelConnection({
              connectionId: item.channelConnectionId,
              reason: failure.message,
            }),
          ]
        : []),
    ]);
    return false;
  }
}

export async function processMessageOutbox(limit = 25) {
  await MessageOutbox.updateMany(
    {
      status: "processing",
      attempts: { $gte: MAX_ATTEMPTS },
      leaseUntil: { $lte: new Date() },
    },
    {
      $set: {
        status: "failed",
        expiresAt: retentionDate(DEAD_LETTER_RETENTION_MS),
        nextAttemptAt: DEAD_LETTER_AT,
        lastError: "Delivery lease expired after the maximum retry count",
      },
      $unset: { leaseUntil: "" },
    },
  );
  const result = { processed: 0, sent: 0, failed: 0, budgetExhausted: false };
  const deadline = Date.now() + BATCH_BUDGET_MS;
  for (let index = 0; index < Math.min(Math.max(limit, 1), 100); index += 1) {
    // Checked BEFORE claiming: a row claimed and then abandoned by a killed
    // invocation is stuck behind its 60s lease for no reason.
    if (Date.now() >= deadline) {
      result.budgetExhausted = true;
      break;
    }
    const item = await claimOutboxItem();
    if (!item) break;
    result.processed += 1;
    if (await processOutboxItem(item)) result.sent += 1;
    else result.failed += 1;
  }
  return result;
}

export async function processQueuedMessageNow(messageId: Types.ObjectId) {
  const item = await claimOutboxItem(messageId);
  if (!item) return { processed: false, sent: false };
  return { processed: true, sent: await processOutboxItem(item) };
}
