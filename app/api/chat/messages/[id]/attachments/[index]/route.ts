import { Types } from "mongoose";
import { withApi } from "@/lib/api/handler";
import {
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { assertConversationAccess } from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";
import { providerAdapter } from "@/lib/conversations/providers/registry";
import { isExternalChannel } from "@/lib/conversations/channels";
import {
  ChannelConnection,
  ConversationMessage,
} from "@/models";

/**
 * Types that may render inline on this origin. Everything else — notably an
 * HTML or SVG "document" a customer can attach in WhatsApp — is forced to
 * download, because `Content-Type` here comes straight from Meta and inline
 * rendering would execute attacker-controlled markup on the app's own origin.
 */
const INLINE_RENDERABLE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/3gpp",
  "audio/aac",
  "audio/amr",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "application/pdf",
]);

/** Drops `; charset=…` and normalises case before the allowlist check. */
function baseContentType(value: string) {
  return value.split(";")[0]?.trim().toLowerCase() || "";
}

function safeFilename(value: string | undefined, fallback: string) {
  const normalized = (value || fallback)
    .replace(/[\r\n]/g, "")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .slice(0, 160);
  return normalized || fallback;
}

export const GET = withApi<{ id: string; index: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "chat:media:get",
      "moderate",
      session.user.role,
    );
    const viewer = await resolveConversationViewer({ session });
    if (!viewer) throw new NotFoundError("Attachment");
    if (!Types.ObjectId.isValid(params.id)) {
      throw new ValidationError("Message is invalid");
    }
    const attachmentIndex = Number.parseInt(params.index, 10);
    if (!Number.isSafeInteger(attachmentIndex) || attachmentIndex < 0) {
      throw new ValidationError("Attachment index is invalid");
    }
    const message = await ConversationMessage.findById(params.id);
    if (!message) throw new NotFoundError("Message");
    const conversation = await assertConversationAccess(
      String(message.conversationId),
      viewer,
    );
    const attachment = message.attachments?.[attachmentIndex];
    if (!attachment?.providerMediaId) {
      throw new NotFoundError("Attachment");
    }
    if (!conversation.channelConnectionId) {
      throw new NotFoundError("Channel connection");
    }
    // WhatsApp and Telegram both reference inbound media by an opaque id that
    // can only be resolved with the connection's own credential, so both are
    // streamed through this viewer-authorized proxy rather than handing the
    // browser a URL that embeds a token.
    if (!isExternalChannel(conversation.channel)) {
      throw new NotFoundError("Channel connection");
    }
    const connection = await ChannelConnection.findOne({
      _id: conversation.channelConnectionId,
      provider: conversation.channel,
      status: "active",
    });
    if (!connection) throw new NotFoundError("Channel connection");

    // Resolved from the adapter, not from `provider === "telegram" ? … : …`.
    // That ternary's else-branch claimed any future provider's media as
    // WhatsApp's; a provider with no `fetchMedia` simply has nothing to serve.
    const fetchMedia = providerAdapter(connection.provider).fetchMedia;
    if (!fetchMedia) throw new NotFoundError("Attachment");
    const media = await fetchMedia({
      connection,
      providerMediaId: attachment.providerMediaId,
    });
    const filename = safeFilename(
      attachment.name,
      `${connection.provider}-${attachment.providerMediaId}`,
    );
    const contentType = baseContentType(media.contentType);
    const renderInline = INLINE_RENDERABLE_TYPES.has(contentType);
    const headers = new Headers({
      // Never relay an unknown provider type verbatim.
      "Content-Type": renderInline ? contentType : "application/octet-stream",
      "Content-Disposition": `${renderInline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Same defence as app/uploads/[...path]: even if a renderable type is
      // spoofed, the response cannot run script or reach back into the origin.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    if (media.contentLength) {
      headers.set("Content-Length", String(media.contentLength));
    }
    return new Response(media.body, { status: 200, headers });
  },
);
