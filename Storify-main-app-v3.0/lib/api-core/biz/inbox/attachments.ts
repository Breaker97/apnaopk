import * as z from "zod";
import { INBOX_REASONS, SendMessageRequest, SentMessage } from "@/contracts/mobile/biz/v1/inbox";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { BIZ_UPLOAD_FORM_POLICY, BizUploadFormInput } from "@/lib/api-core/biz/upload-form";
import { defineBizRoute } from "@/lib/api-core/registry";
import { conversationIdParam } from "@/lib/api-core/shop/chat/shopper-chat";
import {
  assertAttachmentsAccepted,
  sendConversationAttachments,
} from "@/lib/conversations/attachments";
import { assertConversationAccess } from "@/lib/conversations/service";
import { connectDB } from "@/lib/db";
import {
  BIZ_ATTACHMENT_CEILING,
  bizConversationViewer,
  toBizConversation,
  toBizMessage,
} from "./biz-inbox";
import { conversationCustomers } from "./customers";

/** The form POST …/attachments reads (contracts … inbox.ts, `ATTACHMENT_FORM_FIELDS`). */
const AttachmentFormInput = z.object({
  file: BizUploadFormInput.shape.file,
  body: SendMessageRequest.shape.body.optional(),
});

/**
 * POST /conversations/{id}/attachments: one file, with optional text, as the
 * website's composer sends it (lib/conversations/attachments.ts): checked
 * against what the conversation's channel takes (refused with
 * `ATTACHMENT_NOT_ACCEPTED`), stored, and added as a reply through
 * `appendConversationMessage`, so the customer is notified and an external
 * channel's delivery is queued alike. The stored file is deleted again when
 * the message is not stored.
 *
 * Sent at most once, as POST …/messages: the `Idempotency-Key` is also the
 * message's `clientMessageId`, and a retry that finds the message stored
 * answers it without uploading the file again.
 */
export const inboxSendAttachmentRoute = defineBizRoute({
  id: "inbox.attachments.send",
  method: "POST",
  path: "/conversations/{id}/attachments",
  auth: "user",
  ...BIZ_ACCESS.REPLY_INBOX,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:inbox:attachments", preset: "strict" },
  demo: "default",
  idempotency: "required",
  form: BIZ_UPLOAD_FORM_POLICY,
  reasons: { values: [...INBOX_REASONS, "UPLOAD_TOO_LARGE"] },
  input: AttachmentFormInput,
  output: SentMessage,
  handler: async ({ input, params, session, workspace, scope, client }) => {
    const conversationId = conversationIdParam(params.id);
    const viewer = bizConversationViewer(session, workspace);
    await connectDB();
    const conversation = await assertConversationAccess(conversationId, viewer);
    assertAttachmentsAccepted(conversation.channel, [input.file], BIZ_ATTACHMENT_CEILING.maxBytes);
    const result = await sendConversationAttachments({
      conversation,
      viewer,
      files: [input.file],
      message: input.body,
      clientMessageId: client.idempotencyKey,
      uploadedBy: session.user.id,
    });
    const customers = await conversationCustomers([result.conversation], { session, workspace, scope });
    return {
      message: toBizMessage(result.message),
      conversation: toBizConversation(result.conversation, {
        workspace,
        operatorId: session.user.id,
        customerId: customers.get(result.conversation._id),
      }),
    };
  },
});
