import { createHash } from "node:crypto";
import {
  ChannelConnection,
  INBOUND_CONNECTION_STATUSES,
  type IChannelConnection,
} from "@/models/channel-connection.model";
import { hashTelegramWebhookSecret } from "@/lib/conversations/secret-box";
import { telegramMessageKey } from "@/lib/conversations/providers/telegram-client";
import {
  ingestInboundMessage,
  type InboundMessageEvent,
} from "@/lib/conversations/providers/ingest";
import {
  claimWebhookReceipt,
  markWebhookReceiptFailed,
  markWebhookReceiptProcessed,
} from "@/lib/conversations/providers/webhook-receipt";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" ? (value as RecordValue) : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Telegram sends `photo` as an array of progressively larger renditions of the
 * same image; the last entry is the original. Picking the largest keeps the
 * agent from seeing a thumbnail.
 */
function largestPhoto(message: RecordValue) {
  const sizes = array(message.photo).map(record);
  if (!sizes.length) return undefined;
  return sizes.reduce((largest, candidate) =>
    Number(candidate.file_size || 0) > Number(largest.file_size || 0)
      ? candidate
      : largest,
  );
}

/**
 * Maps a Telegram message to our attachment shape.
 *
 * Everything is referenced by `file_id`, not a URL — resolving it needs the bot
 * token, which is exactly why it is stored as `providerMediaId` and served
 * through the viewer-authorized proxy, the same way WhatsApp media ids are.
 */
function telegramAttachments(message: RecordValue) {
  const photo = largestPhoto(message);
  if (photo?.file_id) {
    return [{ type: "image" as const, providerMediaId: text(photo.file_id) }];
  }
  const candidates: Array<{
    key: string;
    type: "video" | "audio" | "document";
  }> = [
    { key: "video", type: "video" },
    { key: "animation", type: "video" },
    { key: "video_note", type: "video" },
    { key: "audio", type: "audio" },
    { key: "voice", type: "audio" },
    { key: "document", type: "document" },
    { key: "sticker", type: "document" },
  ];
  for (const candidate of candidates) {
    const media = record(message[candidate.key]);
    const fileId = text(media.file_id);
    if (!fileId) continue;
    return [
      {
        type: candidate.type,
        providerMediaId: fileId,
        name: text(media.file_name) || undefined,
        mimeType: text(media.mime_type) || undefined,
      },
    ];
  }
  return [];
}

/** A readable body for a message whose content is not text. */
function telegramBody(message: RecordValue) {
  const direct = text(message.text) || text(message.caption);
  if (direct) return direct;
  if (array(message.photo).length) return "[Photo]";
  if (record(message.sticker).file_id) {
    const emoji = text(record(message.sticker).emoji);
    return emoji ? `[Sticker ${emoji}]` : "[Sticker]";
  }
  if (record(message.voice).file_id) return "[Voice message]";
  if (record(message.video_note).file_id) return "[Video note]";
  if (record(message.animation).file_id) return "[GIF]";
  if (record(message.video).file_id) return "[Video]";
  if (record(message.audio).file_id) return "[Audio]";
  if (record(message.document).file_id) return "[Document]";
  if (record(message.location).latitude !== undefined) return "[Location]";
  if (record(message.contact).phone_number) return "[Shared a contact]";
  return "[Telegram message]";
}

function senderName(from: RecordValue, chat: RecordValue) {
  const parts = [text(from.first_name), text(from.last_name)].filter(Boolean);
  return (
    parts.join(" ") ||
    text(from.username) ||
    text(chat.title) ||
    text(from.id) ||
    "Telegram user"
  );
}

/**
 * Normalises a Telegram update into the shared inbound shape.
 *
 * `connectionLookupId` is intentionally the bot id rather than something taken
 * from the payload: an update names the chat and the sender, never the bot that
 * received it. The webhook secret is what identifies the connection.
 */
export function extractTelegramEvents(
  payload: unknown,
  connection: IChannelConnection,
) {
  const inbound: InboundMessageEvent[] = [];
  const update = record(payload);
  // An edit carries the SAME `message_id`, so it lands on the message already
  // stored and is flagged rather than ingested: without the flag the dedupe in
  // `ingestInboundMessage` returned early and the corrected text — often the
  // one that fixes a wrong address or order number — never reached the agent.
  const edited = !update.message && Boolean(update.edited_message);
  const message = record(update.message || update.edited_message);
  const from = record(message.from);
  const chat = record(message.chat);
  const chatId = text(chat.id) || String(chat.id ?? "");
  const messageId = text(message.message_id) || String(message.message_id ?? "");

  // Bots must not talk to bots, and a chat we cannot address is not a thread.
  if (!chatId || !messageId || from.is_bot === true) {
    return { inbound, updateId: String(update.update_id ?? "") };
  }
  // Groups and channels are out of scope: this inbox models 1:1 support.
  if (text(chat.type) && text(chat.type) !== "private") {
    return { inbound, updateId: String(update.update_id ?? "") };
  }

  inbound.push({
    provider: "telegram",
    connectionLookupId: connection.telegramBotId || "",
    // The chat id is what we reply to, so it is the thread identity.
    externalUserId: chatId,
    senderName: senderName(from, chat),
    body: telegramBody(message),
    attachments: telegramAttachments(message),
    // Chat-scoped: a bare per-chat message_id collides across chats under the
    // global {channel, providerMessageId} unique index.
    providerMessageId: telegramMessageKey(chatId, messageId),
    occurredAt: new Date(Number(message.date || 0) * 1000 || Date.now()),
    edited,
  });
  return { inbound, updateId: String(update.update_id ?? "") };
}

/**
 * Finds the bot an update belongs to.
 *
 * Telegram signs nothing, so this header is simultaneously the authentication
 * and the routing key. Only its hash is stored, so a database read cannot be
 * replayed as a valid webhook.
 */
export async function resolveTelegramConnection(secretHeader: string | null) {
  const secret = secretHeader?.trim();
  if (!secret || secret.length > 256) return null;
  return ChannelConnection.findOne({
    provider: "telegram",
    // A bot whose token died still delivers updates, and refusing them here
    // answered 401 until Telegram disabled the webhook outright — turning a
    // fixable credential problem into a permanently detached bot.
    status: { $in: INBOUND_CONNECTION_STATUSES },
    telegramWebhookSecretHash: hashTelegramWebhookSecret(secret),
  });
}

export async function processTelegramUpdate(params: {
  connection: IChannelConnection;
  payload: unknown;
  rawBody: string;
}) {
  const { inbound, updateId } = extractTelegramEvents(
    params.payload,
    params.connection,
  );
  // Telegram redelivers an update until it gets a 2xx, so the same receipt
  // guard the Meta webhook uses applies here — keyed on the bot so two bots
  // cannot collide on Telegram's per-bot update_id counter.
  const payloadHash = createHash("sha256")
    .update(params.rawBody)
    .digest("hex");
  const eventKey = `${params.connection.telegramBotId || "unknown"}:${
    updateId || payloadHash.slice(0, 32)
  }`;
  const claim = await claimWebhookReceipt({
    provider: "telegram",
    eventKey,
    payloadHash,
  });
  if (claim.duplicate) return { duplicate: true, processed: 0 };

  try {
    let processed = 0;
    for (const event of inbound) {
      await ingestInboundMessage(params.connection, event);
      processed += 1;
    }
    await markWebhookReceiptProcessed(claim.receipt);
    return { duplicate: false, processed };
  } catch (error) {
    // Settle the receipt as failed so Telegram's next redelivery re-claims it.
    // Leaving it `processing` made a transient fault permanent message loss.
    await markWebhookReceiptFailed(claim.receipt, error);
    throw error;
  }
}
