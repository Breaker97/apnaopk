import { withApi } from "@/lib/api/handler";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import {
  appendConversationMessage,
  assertConversationAccess,
  requireConversationViewer,
} from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";
import { getStorageConfig, getStorageService } from "@/lib/storage";
import { uploadMediaFile } from "@/lib/media-upload/upload-file";
import {
  attachmentKindFor,
  channelCapability,
  MAX_CHAT_ATTACHMENT_BYTES,
} from "@/lib/conversations/channels";

function formatMegabytes(bytes: number) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
}

function attachmentKind(mimeType: string) {
  const kind = attachmentKindFor(mimeType);
  if (!kind) throw new ValidationError("Unsupported chat attachment type");
  return kind;
}

export const POST = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "chat:attachments:send",
      "strict",
      session.user.role,
    );
    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );
    const conversation = await assertConversationAccess(params.id, viewer);
    const formData = await request.formData();
    const files = [
      ...(formData.get("file") instanceof File
        ? [formData.get("file") as File]
        : []),
      ...formData
        .getAll("files")
        .filter((value): value is File => value instanceof File),
    ];
    if (!files.length) throw new ValidationError("An attachment is required");
    // Everything about what this channel accepts comes from one table, so a
    // channel added later cannot silently inherit live-chat's permissive rules.
    const capability = channelCapability(conversation.channel);
    const externalChannel = capability.external;
    if (files.length > capability.maxAttachments) {
      throw new ValidationError(
        `${capability.label} supports ${capability.maxAttachments} attachment${capability.maxAttachments === 1 ? "" : "s"} per message`,
      );
    }
    for (const file of files) {
      const maximum = capability.media[file.type];
      if (!maximum) {
        throw new ValidationError(
          `${capability.label} does not accept ${file.type || "this"} attachments. Supported: ${Object.keys(capability.media).join(", ")}.`,
        );
      }
      if (file.size <= 0) {
        throw new ValidationError("Each chat attachment must not be empty");
      }
      if (file.size > Math.min(maximum, MAX_CHAT_ATTACHMENT_BYTES)) {
        throw new ValidationError(
          `${capability.label} limits ${file.type} attachments to ${formatMegabytes(Math.min(maximum, MAX_CHAT_ATTACHMENT_BYTES))}.`,
        );
      }
    }
    const message = String(formData.get("message") || "").trim();
    if (message.length > 4000) {
      throw new ValidationError("Message cannot exceed 4000 characters");
    }
    const clientMessageId =
      String(formData.get("clientMessageId") || "").trim() || undefined;
    if (clientMessageId && clientMessageId.length > 100) {
      throw new ValidationError("Client message ID is too long");
    }

    const config = await getStorageConfig();
    const storage = await getStorageService();
    const uploaded = [];
    try {
      for (const file of files) {
        const record = await uploadMediaFile(file, {
          config,
          storage,
          uploadedBy: session.user.id,
          // The default WebP re-encode would turn every validated JPEG/PNG into
          // a format WhatsApp rejects, so an external-channel attachment keeps
          // the format that was just checked against the provider's allowlist.
          preserveOriginalFormat: externalChannel,
          // The capability table above is the authority for chat, and it is
          // stricter than the global storage allowlist — which has no audio
          // types, so Telegram voice notes were accepted and then rejected
          // mid-upload.
          additionalAllowedMimeTypes: Object.keys(capability.media),
        });
        uploaded.push(record);
      }
      if (
        externalChannel &&
        uploaded.some((record) => !/^https:\/\//i.test(record.url))
      ) {
        throw new ValidationError(
          "External channel attachments require storage with a public HTTPS URL",
        );
      }
      return successResponse(
        await appendConversationMessage({
          conversationId: params.id,
          viewer,
          message,
          clientMessageId,
          attachments: uploaded.map((record) => ({
            type: attachmentKind(record.mimeType),
            url: record.url,
            name: record.filename,
            mimeType: record.mimeType,
            size: record.size,
          })),
        }),
        "Attachment sent",
      );
    } catch (error) {
      await Promise.allSettled(
        uploaded.map((record) => storage.deleteFile(record.key)),
      );
      throw error;
    }
  },
);
