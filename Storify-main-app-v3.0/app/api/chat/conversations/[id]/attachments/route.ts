import { withApi } from "@/lib/api/handler";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import {
  assertConversationAccess,
  requireConversationViewer,
} from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";
import {
  assertAttachmentsAccepted,
  sendConversationAttachments,
} from "@/lib/conversations/attachments";
import { WEB_CHAT_ATTACHMENT_CEILING } from "@/lib/conversations/channels";

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
    // Everything about what this channel accepts comes from one table, so a
    // channel added later cannot silently inherit live-chat's permissive rules.
    assertAttachmentsAccepted(
      conversation.channel,
      files,
      WEB_CHAT_ATTACHMENT_CEILING.maxBytes,
    );
    const message = String(formData.get("message") || "").trim();
    if (message.length > 4000) {
      throw new ValidationError("Message cannot exceed 4000 characters");
    }
    const clientMessageId =
      String(formData.get("clientMessageId") || "").trim() || undefined;
    if (clientMessageId && clientMessageId.length > 100) {
      throw new ValidationError("Client message ID is too long");
    }

    return successResponse(
      await sendConversationAttachments({
        conversation,
        viewer,
        files,
        message,
        clientMessageId,
        uploadedBy: session.user.id,
      }),
      "Attachment sent",
    );
  },
);
