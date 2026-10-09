import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import {
  ChatConversationList,
  ChatConversationListQuery,
} from "@/contracts/mobile/shop/v1/chat";
import { defineRoute } from "@/lib/api-core/registry";
import { connectDB, mongoose } from "@/lib/db";
import {
  countUnreadConversationMessages,
  listConversations,
  parseConversationCursor,
} from "@/lib/conversations/service";
import { Conversation } from "@/models";
import {
  decodeChatCursor,
  encodeChatCursor,
  shopperChatViewer,
  toChatConversations,
} from "./shopper-chat";

/**
 * GET /chat/conversations: the shopper's conversations, most recent activity
 * first, with the unread total for the badge.
 *
 * Asked again whenever the chat tab shows, and most of those find nothing
 * new. Every change a row shows (a message either way, a read, a status) is a
 * write to its conversation, so one aggregate over the shopper's handful of
 * conversations is the version, and an unchanged list answers 304 before it
 * is read. A seller renaming their store, or changing its logo, is not such
 * a write: that name catches up with the conversation's next message, as on
 * the website, and the logo is read, for the page, in one query.
 */
export const chatConversationListRoute = defineRoute({
  id: "chat.conversations.list",
  method: "GET",
  path: "/chat/conversations",
  auth: "user",
  cache: { kind: "private" },
  input: ChatConversationListQuery,
  output: ChatConversationList,
  validator: async ({ session }) => {
    await connectDB();
    const [version] = await Conversation.aggregate<{ count: number; newest: Date | null }>([
      { $match: { customerUserId: new mongoose.Types.ObjectId(session.user.id) } },
      { $group: { _id: null, count: { $sum: 1 }, newest: { $max: "$updatedAt" } } },
    ]);
    return version ? [version.count, new Date(version.newest ?? 0).getTime()] : [0, 0];
  },
  handler: async ({ input, session }) => {
    const viewer = shopperChatViewer(session);
    const before = decodeChatCursor(input.cursor, (value) => Boolean(parseConversationCursor(value)));
    await connectDB();
    const [page, unreadCount] = await Promise.all([
      listConversations({ viewer, limit: input.limit ?? LIST_DEFAULT_LIMIT, before }),
      countUnreadConversationMessages({ viewer }),
    ]);
    return {
      items: await toChatConversations(page.conversations),
      nextCursor: encodeChatCursor(page.nextCursor),
      unreadCount,
    };
  },
});
