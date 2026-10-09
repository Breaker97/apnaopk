import { ConversationReadResult } from "@/contracts/mobile/biz/v1/inbox";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { defineBizRoute } from "@/lib/api-core/registry";
import { conversationIdParam } from "@/lib/api-core/shop/chat/shopper-chat";
import { countUnreadConversationMessages, markConversationRead } from "@/lib/conversations/service";
import { connectDB } from "@/lib/db";
import { bizConversationViewer } from "./biz-inbox";

/**
 * POST /conversations/{id}/read: the operator has seen the customer's
 * messages in it. Answers what is left unread across the conversations they
 * can open, for the badge.
 *
 * The unread count of a conversation is the team's, not one person's: reading
 * it here clears it for everyone on the same side, as it does on the website.
 * Needs only the right to see the inbox, as there.
 */
export const inboxConversationReadRoute = defineBizRoute({
  id: "inbox.conversations.read",
  method: "POST",
  path: "/conversations/{id}/read",
  auth: "user",
  ...BIZ_ACCESS.VIEW_INBOX,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:inbox:read", preset: "lenient" },
  demo: "default",
  output: ConversationReadResult,
  handler: async ({ params, session, workspace }) => {
    const conversationId = conversationIdParam(params.id);
    const viewer = bizConversationViewer(session, workspace);
    await connectDB();
    await markConversationRead({ conversationId, viewer });
    return { unreadCount: await countUnreadConversationMessages({ viewer }) };
  },
});
