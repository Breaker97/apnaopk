import { CHAT_REASONS, ChatStartResult, StartChatRequest } from "@/contracts/mobile/shop/v1/chat";
import { defineRoute } from "@/lib/api-core/registry";
import { connectDB } from "@/lib/db";
import { startLiveConversation } from "@/lib/conversations/service";
import { shopperChatViewer, toChatConversationWithLogo, toChatMessage } from "./shopper-chat";

/**
 * POST /chat/conversations: the shopper's first message about a product, a
 * seller or the store.
 *
 * `startLiveConversation`, as the website's storefront chat button starts
 * one: it goes to whoever sells the product, carries the product as it is
 * now, and lands in the shopper's open conversation about the same thing when
 * there is one (`created: false`). Refused while the seller, or the store, is
 * not taking chats (`CHAT_UNAVAILABLE`); the shopper's name and email come from
 * the session, never from the request.
 */
export const chatStartRoute = defineRoute({
  id: "chat.conversations.start",
  method: "POST",
  path: "/chat/conversations",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "chat:start", preset: "moderate" },
  demo: "default",
  reasons: { values: CHAT_REASONS },
  input: StartChatRequest,
  output: ChatStartResult,
  handler: async ({ input, session }) => {
    await connectDB();
    const result = await startLiveConversation({
      viewer: shopperChatViewer(session),
      message: input.message,
      clientMessageId: input.clientMessageId,
      productId: input.productId,
      vendorId: input.vendorId,
      variantId: input.variantId,
    });
    return {
      conversation: await toChatConversationWithLogo(result.conversation),
      message: toChatMessage(result.message),
      created: result.created,
    };
  },
});
