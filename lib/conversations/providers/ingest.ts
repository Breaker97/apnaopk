import {
  type IChannelConnection,
  type MessageProvider,
} from "@/models/channel-connection.model";
import {
  Conversation,
  ConversationContact,
  ConversationMessage,
} from "@/models";
import {
  CONVERSATION_OWNER_TYPES,
  CONVERSATION_STATUSES,
} from "@/models/conversation.model";
import {
  CONVERSATION_MESSAGE_DIRECTIONS,
  CONVERSATION_MESSAGE_SENDER_TYPES,
  CONVERSATION_MESSAGE_STATUSES,
} from "@/models/conversation-message.model";
import { fetchMessengerPlatformProfile } from "@/lib/conversations/providers/meta-client";
import { afterResponse } from "@/lib/after-response";
import {
  channelLabel,
  humanAgentWindowMs,
  replyWindowMs,
  supportsMessengerPlatformProfile,
} from "@/lib/conversations/channels";
import { notifyStoreAboutInbound } from "@/lib/conversations/service";

/**
 * One inbound message, normalised away from any provider's wire format.
 *
 * Everything downstream of this — contact identity, thread creation, unread
 * counters, reply windows, notifications — is provider-neutral, which is why
 * Telegram reuses it wholesale despite sharing no transport with Meta.
 */
export interface InboundMessageEvent {
  provider: MessageProvider;
  /** How the receiving account is identified inside the payload, if at all. */
  connectionLookupId: string;
  externalUserId: string;
  senderName: string;
  body: string;
  attachments: Array<{
    type: "image" | "video" | "audio" | "document";
    url?: string;
    name?: string;
    mimeType?: string;
    providerMediaId?: string;
  }>;
  providerMessageId: string;
  occurredAt: Date;
  /**
   * The customer revised a message we already stored, rather than sending a
   * new one. Only Telegram reports this; Meta models the same intent as a
   * deletion, handled separately by the Meta webhook.
   */
  edited?: boolean;
}

/**
 * Window ends are derived from the channel capability rather than restated as
 * literals, so a channel with a different provider window cannot silently
 * inherit WhatsApp's 24 hours or Messenger's 7 days.
 */
function providerReplyWindowEnd(event: InboundMessageEvent) {
  const window = replyWindowMs(event.provider);
  return window === undefined
    ? undefined
    : new Date(event.occurredAt.getTime() + window);
}

function providerHumanAgentWindowEnd(
  event: InboundMessageEvent,
  connection: IChannelConnection,
) {
  const window = humanAgentWindowMs(event.provider);
  return window !== undefined && connection.messengerHumanAgentEnabled
    ? new Date(event.occurredAt.getTime() + window)
    : undefined;
}

/**
 * The Messenger Platform webhook carries only an opaque scoped ID, so the
 * sender name defaults to that ID. Resolve the real display name once — when
 * the contact is first seen, or while it is still labelled with the raw ID —
 * rather than on every inbound message.
 */
async function resolveExternalDisplayName(
  connection: IChannelConnection,
  event: InboundMessageEvent,
  existingName?: string,
) {
  // Capability-gated, NOT `!== "whatsapp"`. That old guard was true for
  // Telegram, so every new Telegram contact handed the BotFather token to
  // graph.facebook.com as a Bearer credential — a live secret leaked to an
  // unrelated third party on the inbound path.
  if (!supportsMessengerPlatformProfile(event.provider)) return undefined;
  const looksUnresolved =
    !existingName || existingName === event.externalUserId;
  if (!looksUnresolved) return undefined;
  return fetchMessengerPlatformProfile({
    connection,
    externalUserId: event.externalUserId,
  });
}

async function upsertExternalContact(
  connection: IChannelConnection,
  event: InboundMessageEvent,
) {
  const identityQuery = {
    channelIdentities: {
      $elemMatch: {
        channelConnectionId: connection._id,
        externalId: event.externalUserId,
      },
    },
  };
  let contact = await ConversationContact.findOne(identityQuery);
  if (!contact) {
    const profile = await resolveExternalDisplayName(connection, event);
    try {
      contact = await ConversationContact.create({
        name: profile?.name || event.senderName,
        ...(profile?.image ? { image: profile.image } : {}),
        ...(event.provider === "whatsapp"
          ? { phone: `+${event.externalUserId.replace(/\D/g, "")}` }
          : {}),
        channelIdentities: [
          {
            channel: event.provider,
            channelConnectionId: connection._id,
            externalId: event.externalUserId,
            // Prefer the handle a human can recognise over the opaque ID.
            displayValue:
              profile?.username || profile?.name || event.externalUserId,
            verifiedAt: new Date(),
          },
        ],
      });
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        (error as { code?: number }).code !== 11000
      ) {
        throw error;
      }
      contact = await ConversationContact.findOne(identityQuery);
      if (!contact) throw error;
    }
  } else {
    // Retry the lookup for a contact still stuck on the raw ID — typically one
    // created while the profile permission was not yet granted.
    const profile = await resolveExternalDisplayName(
      connection,
      event,
      contact.name,
    );
    const nextName = profile?.name || event.senderName;
    if (nextName && contact.name !== nextName) {
      contact.name = nextName;
      if (profile?.image) contact.image = profile.image;
      await contact.save();
    }
  }
  return contact;
}

/**
 * Rewrites a stored message the customer has since edited.
 *
 * The thread's own header is only touched when this message is still the latest
 * one — editing something from an hour ago must not drag the conversation back
 * to the top of the inbox or restate an old line as the current preview. Unread
 * counters are left alone for the same reason: an edit is not a new message.
 */
async function applyInboundEdit(
  message: NonNullable<Awaited<ReturnType<typeof ConversationMessage.findOne>>>,
  event: InboundMessageEvent,
) {
  const body = event.body.slice(0, 4000);
  if (message.body === body) return message;
  const updated =
    (await ConversationMessage.findOneAndUpdate(
      { _id: message._id },
      { $set: { body, attachments: event.attachments } },
      { returnDocument: "after" },
    )) || message;
  await Conversation.updateOne(
    { _id: message.conversationId, lastMessageId: message._id },
    { $set: { lastMessagePreview: body.slice(0, 240) } },
  );
  return updated;
}

/**
 * Whether the arriving message is actually the newest one in its thread.
 *
 * Both providers redeliver a batch until they get a 2xx, so a webhook landing
 * AFTER a newer one already succeeded is ordinary traffic, not a fault. The
 * conversation header describes the LATEST message, so every field derived from
 * it may only move forward — writing them unconditionally let a retried batch
 * restore a stale preview and re-sort the thread above conversations that had
 * since been answered.
 *
 * Exported because it is the ordering rule itself; the rest of the update is
 * bookkeeping.
 */
export function isLatestInboundExpression(occurredAt: Date) {
  return {
    $gte: [occurredAt, { $ifNull: ["$lastMessageAt", new Date(0)] }],
  };
}

export async function ingestInboundMessage(
  connection: IChannelConnection,
  event: InboundMessageEvent,
) {
  const duplicate = await ConversationMessage.findOne({
    channel: event.provider,
    providerMessageId: event.providerMessageId,
  });
  if (duplicate) {
    return event.edited
      ? applyInboundEdit(duplicate, event)
      : duplicate;
  }

  const contact = await upsertExternalContact(connection, event);
  let conversation = await Conversation.findOne({
    channelConnectionId: connection._id,
    externalThreadId: event.externalUserId,
  });
  const isNew = !conversation;
  if (!conversation) {
    conversation = await Conversation.create({
      channel: event.provider,
      ownerType:
        connection.ownerType === "vendor"
          ? CONVERSATION_OWNER_TYPES.VENDOR
          : CONVERSATION_OWNER_TYPES.PLATFORM,
      ownerVendorId: connection.ownerVendorId,
      channelConnectionId: connection._id,
      contactId: contact._id,
      contact: {
        name: contact.name,
        phone: contact.phone,
        image: contact.image,
      },
      subject: `${channelLabel(event.provider)} conversation`,
      status: CONVERSATION_STATUSES.OPEN,
      externalThreadId: event.externalUserId,
      lastMessagePreview: event.body.slice(0, 240),
      lastMessageAt: event.occurredAt,
      lastInboundAt: event.occurredAt,
      replyWindowExpiresAt: providerReplyWindowEnd(event),
      humanAgentWindowExpiresAt: providerHumanAgentWindowEnd(event, connection),
      unreadForCustomer: 0,
      unreadForStore: 1,
    });
  }

  let message;
  try {
    message = await ConversationMessage.create({
      conversationId: conversation._id,
      channel: event.provider,
      direction: CONVERSATION_MESSAGE_DIRECTIONS.INBOUND,
      senderType: CONVERSATION_MESSAGE_SENDER_TYPES.CUSTOMER,
      senderName: event.senderName,
      body: event.body.slice(0, 4000),
      attachments: event.attachments,
      providerMessageId: event.providerMessageId,
      deliveryStatus: CONVERSATION_MESSAGE_STATUSES.DELIVERED,
      createdAt: event.occurredAt,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: number }).code === 11000
    ) {
      return ConversationMessage.findOne({
        channel: event.provider,
        providerMessageId: event.providerMessageId,
      });
    }
    if (isNew) await Conversation.deleteOne({ _id: conversation._id });
    throw error;
  }

  const humanAgentWindowExpiresAt = providerHumanAgentWindowEnd(
    event,
    connection,
  );
  const replyWindowEnd = providerReplyWindowEnd(event);
  const isLatest = isLatestInboundExpression(event.occurredAt);
  // One atomic pipeline update. A webhook batch and a live agent reply can
  // touch the same document concurrently, so a read-modify-write `save()` would
  // drop one of the unread increments; and the spam check has to read the
  // server's current status rather than the snapshot loaded earlier.
  const updatedConversation =
    (await Conversation.findOneAndUpdate(
      { _id: conversation._id },
      [
        {
          $set: {
            lastMessageId: { $cond: [isLatest, message._id, "$lastMessageId"] },
            lastMessagePreview: {
              $cond: [
                isLatest,
                event.body.slice(0, 240),
                "$lastMessagePreview",
              ],
            },
            lastMessageAt: {
              $cond: [isLatest, event.occurredAt, "$lastMessageAt"],
            },
            // Monotonic for the same reason, and `$max` ignores an absent left
            // operand, so the first inbound message still sets it.
            lastInboundAt: { $max: ["$lastInboundAt", event.occurredAt] },
            // A late redelivery must never shrink a window a newer message has
            // already extended — that would refuse a reply the provider accepts.
            replyWindowExpiresAt: replyWindowEnd
              ? { $max: ["$replyWindowExpiresAt", replyWindowEnd] }
              : replyWindowEnd,
            unreadForCustomer: 0,
            unreadForStore: {
              $add: [{ $ifNull: ["$unreadForStore", 0] }, isNew ? 0 : 1],
            },
            // A thread marked spam stays marked; anything else reopens.
            status: {
              $cond: [
                { $eq: ["$status", CONVERSATION_STATUSES.SPAM] },
                "$status",
                CONVERSATION_STATUSES.OPEN,
              ],
            },
            ...(humanAgentWindowExpiresAt ? { humanAgentWindowExpiresAt } : {}),
          },
        },
        {
          $unset: [
            // A fresh inbound message restarts the escalation clock.
            "escalationNotifiedAt",
            ...(humanAgentWindowExpiresAt ? [] : ["humanAgentWindowExpiresAt"]),
          ],
        },
      ],
      { returnDocument: "after" },
    )) || conversation;
  afterResponse(() => notifyStoreAboutInbound(updatedConversation, event.body));
  return message;
}

