import { ChatReadResult } from "@/contracts/mobile/shop/v1/chat";
import { defineRoute } from "@/lib/api-core/registry";
import { connectDB } from "@/lib/db";
import {
  countUnreadConversationMessages,
  markConversationRead,
} from "@/lib/conversations/service";
import { conversationIdParam, shopperChatViewer } from "./shopper-chat";

/**
 * POST /chat/conversations/{id}/read: the shopper has seen the store's
 * messages in it. Answers what is left unread across their conversations,
 * for the badge.
 */
export const chatReadRoute = defineRoute({
  id: "chat.conversations.read",
  method: "POST",
  path: "/chat/conversations/{id}/read",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "chat:read", preset: "lenient" },
  demo: "default",
  output: ChatReadResult,
  handler: async ({ params, session }) => {
    const conversationId = conversationIdParam(params.id);
    const viewer = shopperChatViewer(session);
    await connectDB();
    await markConversationRead({ conversationId, viewer });
    return { unreadCount: await countUnreadConversationMessages({ viewer }) };
  },
});
