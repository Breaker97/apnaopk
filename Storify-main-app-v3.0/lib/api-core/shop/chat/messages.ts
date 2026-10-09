import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import { ChatMessagePage, ChatMessagesQuery } from "@/contracts/mobile/shop/v1/chat";
import { defineRoute } from "@/lib/api-core/registry";
import { connectDB, mongoose } from "@/lib/db";
import { listConversationMessages } from "@/lib/conversations/service";
import { Conversation, ConversationMessage } from "@/models";
import {
  conversationIdParam,
  decodeChatCursor,
  encodeChatCursor,
  isShopperVisible,
  shopperChatViewer,
  toChatConversationWithLogo,
  toChatMessage,
} from "./shopper-chat";

type VersionRow = {
  updatedAt?: Date;
  lastMessageId?: unknown;
  unreadForCustomer?: number;
  status?: string;
};

/**
 * GET /chat/conversations/{id}/messages: one of the shopper's conversations,
 * a page of its messages at a time, the newest first.
 *
 * Asked again every few seconds while the conversation is on screen. The
 * validator reads two documents: the conversation (every message, read and
 * status is a write to it) and its most recently changed message (a change to
 * a message is not). An unchanged conversation answers 304 before its
 * messages are read. Somebody else's conversation has no version, so it runs
 * the handler and is a 404, the same as one that does not exist.
 */
export const chatMessagesRoute = defineRoute({
  id: "chat.messages.list",
  method: "GET",
  path: "/chat/conversations/{id}/messages",
  auth: "user",
  cache: { kind: "private" },
  input: ChatMessagesQuery,
  output: ChatMessagePage,
  validator: async ({ params, session }) => {
    if (!mongoose.isValidObjectId(params.id)) return null;
    await connectDB();
    const conversation = await Conversation.findOne({
      _id: params.id,
      customerUserId: session.user.id,
    })
      .select("updatedAt lastMessageId unreadForCustomer status")
      .lean<VersionRow | null>();
    if (!conversation) return null;
    // The team's notes are not the shopper's: one written does not move the version.
    const newest = await ConversationMessage.findOne({ conversationId: params.id, direction: { $ne: "internal" } })
      .sort({ updatedAt: -1 })
      .select("updatedAt")
      .lean<{ updatedAt?: Date } | null>();
    return [
      new Date(conversation.updatedAt ?? 0).getTime(),
      String(conversation.lastMessageId ?? ""),
      conversation.unreadForCustomer ?? 0,
      conversation.status ?? "",
      new Date(newest?.updatedAt ?? 0).getTime(),
    ];
  },
  handler: async ({ input, params, session }) => {
    const conversationId = conversationIdParam(params.id);
    const before = decodeChatCursor(input.cursor, (value) => mongoose.isValidObjectId(value));
    await connectDB();
    const page = await listConversationMessages({
      conversationId,
      viewer: shopperChatViewer(session),
      before,
      limit: input.limit ?? LIST_DEFAULT_LIMIT,
    });
    return {
      // The service pages oldest-to-newest within a page; the app reads the
      // newest first.
      items: page.messages.filter(isShopperVisible).reverse().map(toChatMessage),
      nextCursor: encodeChatCursor(page.nextCursor),
      conversation: await toChatConversationWithLogo(page.conversation),
    };
  },
});
