import { ValidationError } from "@/lib/api/errors";
import {
  attachmentKindFor,
  channelCapability,
  MAX_CHAT_ATTACHMENT_BYTES,
} from "@/lib/conversations/channels";
import {
  appendConversationMessage,
  assertConversationAccess,
  serializeConversation,
  serializeConversationMessage,
} from "@/lib/conversations/service";
import type { ConversationViewer } from "@/lib/conversations/types";
import { uploadMediaFile } from "@/lib/media-upload/upload-file";
import { getStorageConfig, getStorageService } from "@/lib/storage";
import { ConversationMessage } from "@/models";
import { CONVERSATION_MESSAGE_DIRECTIONS } from "@/models/conversation-message.model";

/**
 * Sending files into a conversation: what a conversation's channel takes, and
 * the upload that stores them and adds the message. The website's composer
 * (app/api/chat/conversations/[id]/attachments) and both apps' attachment
 * endpoints go through here, so a file one of them takes is a file the
 * channel can deliver, whichever sent it.
 *
 * Every rule comes from the channel's row in `CHANNEL_CAPABILITIES`
 * (./channels.ts): a channel added later cannot inherit live chat's
 * permissive rules by accident.
 */

type Conversation = Awaited<ReturnType<typeof assertConversationAccess>>;

interface FileLike {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * A file the channel does not take (its type, its size, how many): the
 * mobile APIs hand `ATTACHMENT_NOT_ACCEPTED` on as their reason, the website
 * shows the message.
 */
function attachmentNotAccepted(message: string): ValidationError {
  const error = new ValidationError(message);
  error.details = { reason: "ATTACHMENT_NOT_ACCEPTED" };
  return error;
}

function formatMegabytes(bytes: number) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
}

/**
 * Refuses files the conversation's channel does not take, before anything is
 * stored. `maxBytes` is a client's transport ceiling, when lower than the
 * channel's own limits.
 */
export function assertAttachmentsAccepted(
  channel: string,
  files: ReadonlyArray<Pick<FileLike, "type" | "size">>,
  maxBytes = MAX_CHAT_ATTACHMENT_BYTES,
) {
  if (!files.length) throw new ValidationError("An attachment is required");
  const capability = channelCapability(channel);
  if (files.length > capability.maxAttachments) {
    throw attachmentNotAccepted(
      `${capability.label} supports ${capability.maxAttachments} attachment${capability.maxAttachments === 1 ? "" : "s"} per message`,
    );
  }
  for (const file of files) {
    const maximum = capability.media[file.type];
    if (!maximum) {
      throw attachmentNotAccepted(
        `${capability.label} does not accept ${file.type || "this"} attachments. Supported: ${Object.keys(capability.media).join(", ")}.`,
      );
    }
    if (file.size <= 0) {
      throw new ValidationError("Each chat attachment must not be empty");
    }
    const limit = Math.min(maximum, MAX_CHAT_ATTACHMENT_BYTES, maxBytes);
    if (file.size > limit) {
      throw attachmentNotAccepted(
        `${capability.label} limits ${file.type} attachments to ${formatMegabytes(limit)}.`,
      );
    }
  }
}

function attachmentKind(mimeType: string) {
  const kind = attachmentKindFor(mimeType);
  if (!kind) throw attachmentNotAccepted("Unsupported chat attachment type");
  return kind;
}

/**
 * Stores files the channel takes (`assertAttachmentsAccepted` first) and adds
 * them as one message, with the text, through `appendConversationMessage`.
 *
 * A message already stored under `clientMessageId` is answered without
 * uploading again, so a retry leaves no second copy in storage. Whatever was
 * uploaded is deleted again when the message is not stored.
 */
export async function sendConversationAttachments(params: {
  conversation: Conversation;
  viewer: ConversationViewer;
  files: readonly FileLike[];
  message?: string;
  clientMessageId?: string;
  uploadedBy: string;
}) {
  const { conversation, viewer } = params;
  if (params.clientMessageId) {
    const duplicate = await ConversationMessage.findOne({
      conversationId: conversation._id,
      clientMessageId: params.clientMessageId,
      // A note is never anybody's reply, whoever reuses its id.
      direction: { $ne: CONVERSATION_MESSAGE_DIRECTIONS.INTERNAL },
    });
    if (duplicate) {
      return {
        conversation: serializeConversation(conversation, viewer),
        message: serializeConversationMessage(duplicate),
      };
    }
  }

  const capability = channelCapability(conversation.channel);
  const externalChannel = capability.external;
  const config = await getStorageConfig();
  const storage = await getStorageService();
  const uploaded = [];
  try {
    for (const file of params.files) {
      const record = await uploadMediaFile(file, {
        config,
        storage,
        uploadedBy: params.uploadedBy,
        // The default WebP re-encode would turn every validated JPEG/PNG into
        // a format WhatsApp rejects, so an external-channel attachment keeps
        // the format that was just checked against the provider's allowlist.
        preserveOriginalFormat: externalChannel,
        // The capability table is the authority for chat, and it is stricter
        // than the global storage allowlist — which has no audio types, so
        // Telegram voice notes were accepted and then rejected mid-upload.
        additionalAllowedMimeTypes: Object.keys(capability.media),
      });
      uploaded.push(record);
    }
    if (
      externalChannel &&
      uploaded.some((record) => !/^https:\/\//i.test(record.url))
    ) {
      throw attachmentNotAccepted(
        "External channel attachments require storage with a public HTTPS URL",
      );
    }
    const result = await appendConversationMessage({
      conversationId: String(conversation._id),
      viewer,
      message: params.message,
      clientMessageId: params.clientMessageId,
      attachments: uploaded.map((record) => ({
        type: attachmentKind(record.mimeType),
        url: record.url,
        name: record.filename,
        mimeType: record.mimeType,
        size: record.size,
      })),
    });
    // A request that raced this one stored the message first: its files are
    // the message's, these are nobody's.
    const kept = new Set(result.message.attachments.map((item) => item.url));
    const orphans = uploaded.filter((record) => !kept.has(record.url));
    if (orphans.length) {
      await Promise.allSettled(
        orphans.map((record) => storage.deleteFile(record.key)),
      );
    }
    return result;
  } catch (error) {
    await Promise.allSettled(
      uploaded.map((record) => storage.deleteFile(record.key)),
    );
    throw error;
  }
}
