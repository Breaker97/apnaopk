import { INBOX_REASONS, SendMessageRequest, SentMessage } from "@/contracts/mobile/biz/v1/inbox";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { defineBizRoute } from "@/lib/api-core/registry";
import { conversationIdParam } from "@/lib/api-core/shop/chat/shopper-chat";
import { appendConversationMessage } from "@/lib/conversations/service";
import { connectDB } from "@/lib/db";
import { bizConversationViewer, toBizConversation, toBizMessage } from "./biz-inbox";
import { conversationCustomers } from "./customers";

/**
 * POST /conversations/{id}/messages: a reply, text or a shared product (its
 * snapshot, with its name and link as the body when no text comes with it),
 * as the website's inbox sends it (`appendConversationMessage`): the customer
 * is notified, the
 * thread becomes `pending` and its unread count clears, and a WhatsApp,
 * Messenger or Instagram reply is queued for the provider.
 *
 * Sent at most once. The pipeline replays the answer of a retried
 * `Idempotency-Key`; the key is also the message's `clientMessageId`, which
 * the service answers with the message already stored, so a retry whose
 * stored answer has expired, or two that race, still send it once.
 *
 * A closed conversation, and a reply past the channel's window (a template is
 * needed, sent from the website), are 409s with the contract's reasons.
 */
export const inboxSendMessageRoute = defineBizRoute({
  id: "inbox.messages.send",
  method: "POST",
  path: "/conversations/{id}/messages",
  auth: "user",
  ...BIZ_ACCESS.REPLY_INBOX,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:inbox:send", preset: "moderate" },
  demo: "default",
  idempotency: "required",
  reasons: { values: INBOX_REASONS },
  input: SendMessageRequest,
  output: SentMessage,
  handler: async ({ input, params, session, workspace, scope, client }) => {
    const conversationId = conversationIdParam(params.id);
    await connectDB();
    const result = await appendConversationMessage({
      conversationId,
      viewer: bizConversationViewer(session, workspace),
      message: input.body,
      productId: input.productId,
      clientMessageId: client.idempotencyKey,
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
