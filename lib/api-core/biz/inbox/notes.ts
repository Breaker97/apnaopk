import { ConversationNoteRequest, INBOX_REASONS, SentMessage } from "@/contracts/mobile/biz/v1/inbox";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { defineBizRoute } from "@/lib/api-core/registry";
import { conversationIdParam } from "@/lib/api-core/shop/chat/shopper-chat";
import { addConversationNote } from "@/lib/conversations/service";
import { connectDB } from "@/lib/db";
import { bizConversationViewer, toBizConversation, toBizMessage } from "./biz-inbox";
import { conversationCustomers } from "./customers";

/**
 * POST /conversations/{id}/notes: an internal note on a conversation, the
 * team's alone (`addConversationNote`): it goes to no channel, nobody is
 * notified, and the thread's header (its last message, unread counts, status
 * and reply window) is left as it was, so the customer never learns of it.
 * Whoever may reply may write one, whatever the status or the window.
 *
 * Written at most once. The pipeline replays the answer of a retried
 * `Idempotency-Key`; the key is also the note's `clientMessageId`, which the
 * service answers with the note already stored, so a retry whose stored
 * answer has expired, or two that race, still write it once.
 */
export const inboxNoteRoute = defineBizRoute({
  id: "inbox.notes.create",
  method: "POST",
  path: "/conversations/{id}/notes",
  auth: "user",
  ...BIZ_ACCESS.REPLY_INBOX,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:inbox:notes", preset: "moderate" },
  demo: "default",
  idempotency: "required",
  reasons: { values: INBOX_REASONS },
  input: ConversationNoteRequest,
  output: SentMessage,
  handler: async ({ input, params, session, workspace, scope, client }) => {
    const conversationId = conversationIdParam(params.id);
    await connectDB();
    const result = await addConversationNote({
      conversationId,
      viewer: bizConversationViewer(session, workspace),
      body: input.body,
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
