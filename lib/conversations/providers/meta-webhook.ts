import { createHash } from "node:crypto";
import {
  ChannelConnection,
  INBOUND_CONNECTION_STATUSES,
  type IChannelConnection,
  type MessageProvider,
} from "@/models/channel-connection.model";
import { Conversation, ConversationMessage } from "@/models";
import {
  CONVERSATION_MESSAGE_DIRECTIONS,
  CONVERSATION_MESSAGE_STATUSES,
} from "@/models/conversation-message.model";
import {
  ingestInboundMessage,
  type InboundMessageEvent,
} from "@/lib/conversations/providers/ingest";
import { connectionLookupFilter } from "@/lib/conversations/providers/registry";
import {
  claimWebhookReceipt,
  markWebhookReceiptFailed,
  markWebhookReceiptProcessed,
} from "@/lib/conversations/providers/webhook-receipt";

/** Meta's parsers produce the shared inbound shape. */
type MetaInboundEvent = InboundMessageEvent;

interface MetaStatusEvent {
  provider: MessageProvider;
  connectionLookupId: string;
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  errorCode?: string;
  errorMessage?: string;
}

interface MetaDeletionEvent {
  provider: MessageProvider;
  connectionLookupId: string;
  providerMessageId: string;
}

interface MetaReadEvent {
  /** Only the Messenger Platform channels emit a read watermark. */
  provider: Exclude<MessageProvider, "whatsapp">;
  connectionLookupId: string;
  externalUserId: string;
  watermark: Date;
}

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object"
    ? (value as RecordValue)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dateFromSeconds(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

function whatsappMessageBody(message: RecordValue) {
  const type = text(message.type) || "message";
  const direct = text(record(message.text).body);
  if (direct) return direct;
  const button = text(record(message.button).text);
  if (button) return button;
  const interactive = record(message.interactive);
  const reply =
    text(record(interactive.button_reply).title) ||
    text(record(interactive.list_reply).title);
  const caption = text(record(message[type]).caption);
  return reply || caption || `[${type} message]`;
}

function whatsappMessageAttachments(message: RecordValue) {
  const type = text(message.type);
  if (!["image", "video", "audio", "document"].includes(type)) return [];
  const media = record(message[type]);
  const providerMediaId = text(media.id);
  if (!providerMediaId) return [];
  return [
    {
      type: type as "image" | "video" | "audio" | "document",
      providerMediaId,
      name: text(media.filename) || undefined,
      mimeType: text(media.mime_type) || undefined,
    },
  ];
}

/**
 * Instagram sends story mentions and shared posts as attachment types that are
 * not plain media. They still carry a media URL, so they render as images
 * rather than being dropped — a story mention used to reach the agent as an
 * empty message with no content at all.
 */
const MESSENGER_ATTACHMENT_TYPES: Record<
  string,
  "image" | "video" | "audio" | "document"
> = {
  image: "image",
  video: "video",
  audio: "audio",
  file: "document",
  story_mention: "image",
  share: "image",
};

function messengerMessageAttachments(message: RecordValue) {
  return array(message.attachments).flatMap((rawAttachment) => {
    const attachment = record(rawAttachment);
    const type = MESSENGER_ATTACHMENT_TYPES[text(attachment.type)];
    const url = text(record(attachment.payload).url);
    if (!url || !type) return [];
    return [{ type, url }];
  });
}

/**
 * A human-readable body for a Messenger Platform message that carries no text:
 * the agent needs to know whether they are looking at a story mention, a reply
 * to their own story, or a plain attachment.
 */
function messengerPlatformBody(message: RecordValue, label: string) {
  const direct = text(message.text);
  const repliedToStory = Boolean(record(record(message.reply_to).story).url);
  const kinds = new Set(
    array(message.attachments).map((attachment) =>
      text(record(attachment).type),
    ),
  );
  if (repliedToStory) {
    return direct ? `[Story reply] ${direct}` : `[Replied to your story]`;
  }
  if (kinds.has("story_mention")) {
    return direct ? `[Story mention] ${direct}` : `[Mentioned you in a story]`;
  }
  if (kinds.has("share")) {
    return direct ? `[Shared post] ${direct}` : `[Shared a post]`;
  }
  return direct || `[${label} attachment]`;
}

/** Tombstones a message the customer retracted on the provider side. */
async function applyMetaDeletionEvent(
  event: MetaDeletionEvent,
  connection: IChannelConnection,
) {
  const message = await ConversationMessage.findOne({
    channel: event.provider,
    providerMessageId: event.providerMessageId,
  }).select("_id conversationId");
  if (!message) return;
  // The same tenancy check `applyMetaStatusEvent` makes, for the same reason: a
  // valid signature only proves Meta sent the batch, not that the account it
  // came from owns the message the id names. Matching on
  // `{ channel, providerMessageId }` alone let one store's webhook blank out a
  // message in another store's thread.
  const belongsToConnection = await Conversation.exists({
    _id: message.conversationId,
    channelConnectionId: connection._id,
  });
  if (!belongsToConnection) return;
  await ConversationMessage.updateOne(
    { _id: message._id },
    {
      $set: {
        body: "[Message deleted by the customer]",
        attachments: [],
        // Merged rather than replaced — the send path keeps the connection and
        // any template payload here, and a tombstone must not erase them.
        "providerMetadata.deletedAt": new Date().toISOString(),
      },
    },
  );
}

export function extractMetaWebhookEvents(payload: unknown) {
  const inbound: MetaInboundEvent[] = [];
  const statuses: MetaStatusEvent[] = [];
  const reads: MetaReadEvent[] = [];
  const deletions: MetaDeletionEvent[] = [];
  const root = record(payload);

  if (root.object === "whatsapp_business_account") {
    for (const rawEntry of array(root.entry)) {
      const entry = record(rawEntry);
      for (const rawChange of array(entry.changes)) {
        const value = record(record(rawChange).value);
        const phoneNumberId = text(record(value.metadata).phone_number_id);
        if (!phoneNumberId) continue;
        const names = new Map<string, string>();
        for (const rawContact of array(value.contacts)) {
          const contact = record(rawContact);
          const id = text(contact.wa_id);
          if (id) names.set(id, text(record(contact.profile).name));
        }
        for (const rawMessage of array(value.messages)) {
          const message = record(rawMessage);
          const externalUserId = text(message.from);
          const providerMessageId = text(message.id);
          if (!externalUserId || !providerMessageId) continue;
          inbound.push({
            provider: "whatsapp",
            connectionLookupId: phoneNumberId,
            externalUserId,
            senderName: names.get(externalUserId) || externalUserId,
            body: whatsappMessageBody(message),
            attachments: whatsappMessageAttachments(message),
            providerMessageId,
            occurredAt: dateFromSeconds(message.timestamp),
          });
        }
        for (const rawStatus of array(value.statuses)) {
          const status = record(rawStatus);
          const providerMessageId = text(status.id);
          const value = text(status.status);
          if (
            providerMessageId &&
            ["sent", "delivered", "read", "failed"].includes(value)
          ) {
            const firstError = record(array(status.errors)[0]);
            statuses.push({
              provider: "whatsapp",
              connectionLookupId: phoneNumberId,
              providerMessageId,
              status: value as MetaStatusEvent["status"],
              errorCode:
                firstError.code === undefined
                  ? undefined
                  : String(firstError.code),
              errorMessage:
                text(firstError.message) ||
                text(firstError.title) ||
                text(record(firstError.error_data).details),
            });
          }
        }
      }
    }
  }

  // Messenger and Instagram Direct are both Messenger Platform: identical
  // `entry[].messaging[]` envelope, different `object` and a different routing
  // key (Page ID vs Instagram professional account ID). Instagram simply never
  // emits `delivery` events, so that branch stays dormant for it.
  const messengerPlatformObjects: Array<{
    object: string;
    provider: "messenger" | "instagram";
  }> = [
    { object: "page", provider: "messenger" },
    { object: "instagram", provider: "instagram" },
  ];
  for (const { object, provider } of messengerPlatformObjects) {
    if (root.object !== object) continue;
    const label = provider === "instagram" ? "Instagram" : "Messenger";
    for (const rawEntry of array(root.entry)) {
      const entry = record(rawEntry);
      const accountId = text(entry.id);
      if (!accountId) continue;
      for (const rawEvent of array(entry.messaging)) {
        const event = record(rawEvent);
        const message = record(event.message);
        const providerMessageId = text(message.mid);
        const externalUserId = text(record(event.sender).id);
        if (providerMessageId && message.is_deleted === true) {
          // Instagram "unsend": the customer retracted a message we already
          // stored. Tombstone it so an agent does not answer something the
          // customer believes they withdrew.
          deletions.push({
            provider,
            connectionLookupId: accountId,
            providerMessageId,
          });
        } else if (
          providerMessageId &&
          externalUserId &&
          message.is_echo !== true
        ) {
          inbound.push({
            provider,
            connectionLookupId: accountId,
            externalUserId,
            senderName: externalUserId,
            body: messengerPlatformBody(message, label),
            attachments: messengerMessageAttachments(message),
            providerMessageId,
            occurredAt: new Date(Number(event.timestamp) || Date.now()),
          });
        } else if (providerMessageId && message.is_echo === true) {
          statuses.push({
            provider,
            connectionLookupId: accountId,
            providerMessageId,
            status: "sent",
          });
        }
        for (const messageId of array(record(event.delivery).mids)) {
          const deliveredId = text(messageId);
          if (deliveredId) {
            statuses.push({
              provider,
              connectionLookupId: accountId,
              providerMessageId: deliveredId,
              status: "delivered",
            });
          }
        }
        const watermark = Number(record(event.read).watermark);
        if (
          externalUserId &&
          Number.isFinite(watermark) &&
          watermark > 0
        ) {
          reads.push({
            provider,
            connectionLookupId: accountId,
            externalUserId,
            watermark: new Date(watermark),
          });
        }
      }
    }
  }

  return { inbound, statuses, reads, deletions };
}

async function applyMetaStatusEvent(
  event: MetaStatusEvent,
  connection: IChannelConnection,
) {
  const status =
    event.status === "read"
      ? CONVERSATION_MESSAGE_STATUSES.READ
      : event.status === "delivered"
        ? CONVERSATION_MESSAGE_STATUSES.DELIVERED
        : event.status === "failed"
          ? CONVERSATION_MESSAGE_STATUSES.FAILED
          : CONVERSATION_MESSAGE_STATUSES.SENT;
  const message = await ConversationMessage.findOne({
    channel: event.provider,
    providerMessageId: event.providerMessageId,
  }).select("_id conversationId deliveryStatus");
  if (!message) return;
  const belongsToConnection = await Conversation.exists({
    _id: message.conversationId,
    channelConnectionId: connection._id,
  });
  if (!belongsToConnection) return;

  const allowedCurrentStatuses =
    status === CONVERSATION_MESSAGE_STATUSES.READ
      ? [
          CONVERSATION_MESSAGE_STATUSES.QUEUED,
          CONVERSATION_MESSAGE_STATUSES.SENT,
          CONVERSATION_MESSAGE_STATUSES.DELIVERED,
          CONVERSATION_MESSAGE_STATUSES.READ,
        ]
      : status === CONVERSATION_MESSAGE_STATUSES.DELIVERED
        ? [
            CONVERSATION_MESSAGE_STATUSES.QUEUED,
            CONVERSATION_MESSAGE_STATUSES.SENT,
            CONVERSATION_MESSAGE_STATUSES.DELIVERED,
          ]
        : status === CONVERSATION_MESSAGE_STATUSES.FAILED
          ? [
              CONVERSATION_MESSAGE_STATUSES.QUEUED,
              CONVERSATION_MESSAGE_STATUSES.SENT,
              CONVERSATION_MESSAGE_STATUSES.FAILED,
            ]
          : [
              CONVERSATION_MESSAGE_STATUSES.QUEUED,
              CONVERSATION_MESSAGE_STATUSES.SENT,
            ];
  await ConversationMessage.updateOne(
    {
      _id: message._id,
      deliveryStatus: { $in: allowedCurrentStatuses },
    },
    {
      $set: {
        deliveryStatus: status,
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
      },
      ...(status !== CONVERSATION_MESSAGE_STATUSES.FAILED
        ? { $unset: { errorCode: "", errorMessage: "" } }
        : {}),
    },
  );
}

/**
 * Delivery states a Messenger/Instagram read watermark is allowed to advance.
 *
 * `queued` is deliberately absent. Unlike the per-message status events, this
 * watermark matches outbound messages on TIME, so a reply still sitting in the
 * outbox falls inside the range and would be reported to the agent as read
 * before the provider had ever been handed it.
 */
export const READ_WATERMARK_ADVANCES_FROM = [
  CONVERSATION_MESSAGE_STATUSES.SENT,
  CONVERSATION_MESSAGE_STATUSES.DELIVERED,
] as const;

export async function applyMetaReadEvent(
  event: MetaReadEvent,
  connection: IChannelConnection,
) {
  const conversation = await Conversation.findOne({
    channelConnectionId: connection._id,
    externalThreadId: event.externalUserId,
    // The channel comes from the event, never a literal: Instagram emits the
    // same `messaging_seen` watermark as Messenger, so hardcoding "messenger"
    // here matched nothing for Instagram and left every outbound Instagram
    // message stuck at `sent` forever.
    channel: event.provider,
  }).select("_id");
  if (!conversation) return;
  await ConversationMessage.updateMany(
    {
      conversationId: conversation._id,
      direction: CONVERSATION_MESSAGE_DIRECTIONS.OUTBOUND,
      createdAt: { $lte: event.watermark },
      deliveryStatus: { $in: [...READ_WATERMARK_ADVANCES_FROM] },
    },
    {
      $set: { deliveryStatus: CONVERSATION_MESSAGE_STATUSES.READ },
      $unset: { errorCode: "", errorMessage: "" },
    },
  );
}

export async function processMetaWebhookPayload(
  rawBody: string,
  payload: unknown,
) {
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const claim = await claimWebhookReceipt({
    provider: "meta",
    eventKey: payloadHash,
    payloadHash,
  });
  if (claim.duplicate) return { duplicate: true, processed: 0 };

  try {
    const events = extractMetaWebhookEvents(payload);
    let processed = 0;
    // Meta batches events per POST, and every event in a batch shares the same
    // account, so the connection is resolved once per distinct routing key
    // instead of once per event.
    const connectionCache = new Map<string, IChannelConnection | null>();
    const resolveConnection = async (event: {
      provider: MessageProvider;
      connectionLookupId: string;
    }) => {
      const cacheKey = `${event.provider}:${event.connectionLookupId}`;
      const cached = connectionCache.get(cacheKey);
      if (cached !== undefined) return cached;
      const filter = connectionLookupFilter(
        event.provider,
        event.connectionLookupId,
      );
      // No filter means this provider does not name its account in the payload,
      // so there is nothing to match on. Spreading the undefined instead left
      // `{ provider, status }`, which matches an ARBITRARY tenant's connection —
      // one customer's message ingested into another store's inbox.
      if (!filter) {
        connectionCache.set(cacheKey, null);
        return null;
      }
      const connection = await ChannelConnection.findOne({
        provider: event.provider,
        // Inbound survives a dead credential; see INBOUND_CONNECTION_STATUSES.
        status: { $in: INBOUND_CONNECTION_STATUSES },
        ...filter,
      });
      if (!connection) {
        console.error(
          `No messaging connection matched a ${event.provider} webhook for account ${event.connectionLookupId}`,
        );
      }
      connectionCache.set(cacheKey, connection);
      return connection;
    };

    for (const event of events.inbound) {
      const connection = await resolveConnection(event);
      if (!connection) continue;
      await ingestInboundMessage(connection, event);
      processed += 1;
    }
    for (const event of events.statuses) {
      const connection = await resolveConnection(event);
      if (!connection) continue;
      await applyMetaStatusEvent(event, connection);
      processed += 1;
    }
    for (const event of events.reads) {
      const connection = await resolveConnection(event);
      if (!connection) continue;
      await applyMetaReadEvent(event, connection);
      processed += 1;
    }
    for (const event of events.deletions) {
      const connection = await resolveConnection(event);
      if (!connection) continue;
      await applyMetaDeletionEvent(event, connection);
      processed += 1;
    }
    await markWebhookReceiptProcessed(claim.receipt);
    return { duplicate: false, processed };
  } catch (error) {
    await markWebhookReceiptFailed(claim.receipt, error);
    throw error;
  }
}
