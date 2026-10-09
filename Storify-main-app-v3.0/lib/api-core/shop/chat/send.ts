import { CHAT_REASONS, ChatSendResult, SendChatMessageRequest } from "@/contracts/mobile/shop/v1/chat";
import { defineRoute } from "@/lib/api-core/registry";
import { connectDB } from "@/lib/db";
import { appendConversationMessage } from "@/lib/conversations/service";
import {
  conversationIdParam,
  shopperChatViewer,
  toChatConversationWithLogo,
  toChatMessage,
} from "./shopper-chat";

/**
 * POST /chat/conversations/{id}/messages: the shopper's reply, text or a
 * shared product (its snapshot, with its name and link as the body when no
 * text comes with it; `PRODUCT_NOT_AVAILABLE` for one the storefront does not
 * show, or another seller's in a seller's conversation).
 *
 * `appendConversationMessage`, as the website's inbox sends it: the store is
 * notified, a resolved conversation opens again, and a retry carrying the
 * same `clientMessageId` answers the message already stored. A closed one
 * refuses (`CONVERSATION_CLOSED`).
 */
export const chatSendRoute = defineRoute({
  id: "chat.messages.send",
  method: "POST",
  path: "/chat/conversations/{id}/messages",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "chat:send", preset: "moderate" },
  demo: "default",
  reasons: { values: CHAT_REASONS },
  input: SendChatMessageRequest,
  output: ChatSendResult,
  handler: async ({ input, params, session }) => {
    const conversationId = conversationIdParam(params.id);
    await connectDB();
    const result = await appendConversationMessage({
      conversationId,
      viewer: shopperChatViewer(session),
      message: input.message,
      productId: input.productId,
      clientMessageId: input.clientMessageId,
    });
    return {
      conversation: await toChatConversationWithLogo(result.conversation),
      message: toChatMessage(result.message),
    };
  },
});
