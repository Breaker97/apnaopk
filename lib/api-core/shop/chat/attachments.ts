import * as z from "zod";
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_REASONS, ChatSendResult } from "@/contracts/mobile/shop/v1/chat";
import { defineRoute } from "@/lib/api-core/registry";
import {
  assertAttachmentsAccepted,
  sendConversationAttachments,
} from "@/lib/conversations/attachments";
import { assertConversationAccess } from "@/lib/conversations/service";
import { connectDB } from "@/lib/db";
import {
  CHAT_ATTACHMENT_CEILING,
  CHAT_ATTACHMENT_FORM_BYTES,
  conversationIdParam,
  shopperChatViewer,
  toChatConversationWithLogo,
  toChatMessage,
} from "./shopper-chat";

const isFile = (value: unknown): value is File =>
  typeof value === "object" &&
  value !== null &&
  "arrayBuffer" in value &&
  "size" in value &&
  "name" in value &&
  "type" in value;

/** The form POST …/attachments reads (contracts … chat.ts, `CHAT_ATTACHMENT_FORM_FIELDS`). */
const ChatAttachmentForm = z.object({
  file: z.custom<File>(isFile, "Send a file."),
  message: z.string().max(CHAT_MESSAGE_MAX_LENGTH).optional(),
  clientMessageId: z.uuid(),
});

/**
 * POST /chat/conversations/{id}/attachments: one file from the shopper, with
 * optional text, as the website's chat sends it
 * (lib/conversations/attachments.ts): checked against what the
 * conversation's channel takes (live chat's rules for a shopper's chat;
 * refused with `ATTACHMENT_NOT_ACCEPTED`), stored, and added through
 * `appendConversationMessage`, so the store is notified alike. The stored
 * file is deleted again when the message is not stored.
 *
 * A retry carrying the same `clientMessageId` answers the message already
 * stored without uploading the file again.
 */
export const chatSendAttachmentRoute = defineRoute({
  id: "chat.attachments.send",
  method: "POST",
  path: "/chat/conversations/{id}/attachments",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "chat:attachments", preset: "strict" },
  demo: "block-mutations",
  form: { maxBytes: CHAT_ATTACHMENT_FORM_BYTES, files: ["file"] },
  reasons: { values: [...CHAT_REASONS, "UPLOAD_TOO_LARGE"] },
  input: ChatAttachmentForm,
  output: ChatSendResult,
  handler: async ({ input, params, session }) => {
    const conversationId = conversationIdParam(params.id);
    const viewer = shopperChatViewer(session);
    await connectDB();
    const conversation = await assertConversationAccess(conversationId, viewer);
    assertAttachmentsAccepted(conversation.channel, [input.file], CHAT_ATTACHMENT_CEILING.maxBytes);
    const result = await sendConversationAttachments({
      conversation,
      viewer,
      files: [input.file],
      message: input.message,
      clientMessageId: input.clientMessageId,
      uploadedBy: session.user.id,
    });
    return {
      conversation: await toChatConversationWithLogo(result.conversation),
      message: toChatMessage(result.message),
    };
  },
});
