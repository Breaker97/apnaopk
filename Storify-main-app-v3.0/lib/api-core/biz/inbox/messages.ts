import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/biz/v1/common";
import { ConversationMessages, ConversationMessagesQuery } from "@/contracts/mobile/biz/v1/inbox";
import { BIZ_ACCESS, grantCan } from "@/lib/api-core/biz/access";
import { defineBizRoute } from "@/lib/api-core/registry";
import {
  conversationIdParam,
  decodeChatCursor,
  encodeChatCursor,
} from "@/lib/api-core/shop/chat/shopper-chat";
import { getConversationAccessQuery, listConversationMessages } from "@/lib/conversations/service";
import { connectDB, mongoose } from "@/lib/db";
import { Conversation, ConversationMessage } from "@/models";
import { bizConversationViewer, toBizConversation, toBizMessage } from "./biz-inbox";
import { conversationCustomers } from "./customers";

type VersionRow = {
  updatedAt?: Date;
  lastMessageId?: unknown;
  unreadForStore?: number;
  status?: string;
};

/**
 * GET /conversations/{id}/messages: one conversation, a page of its messages
 * at a time, the newest first; `cursor` pages back in time.
 *
 * Asked again every few seconds while the thread is on screen. The validator
 * reads two documents: the conversation, within what the viewer may open
 * (every message, read and status is a write to it), and its most recently
 * changed message (a delivery receipt writes the message only). An unchanged
 * thread answers 304 before its messages are read. Somebody else's
 * conversation has no version, so the handler runs and it is a 404, the same
 * as one that does not exist.
 */
export const inboxMessagesRoute = defineBizRoute({
  id: "inbox.messages.list",
  method: "GET",
  path: "/conversations/{id}/messages",
  auth: "user",
  ...BIZ_ACCESS.VIEW_INBOX,
  cache: { kind: "private" },
  input: ConversationMessagesQuery,
  output: ConversationMessages,
  validator: async ({ params, session, workspace }) => {
    if (!mongoose.isValidObjectId(params.id)) return null;
    const viewer = bizConversationViewer(session, workspace);
    await connectDB();
    const conversation = await Conversation.findOne({
      _id: params.id,
      ...getConversationAccessQuery(viewer),
    })
      .select("updatedAt lastMessageId unreadForStore status")
      .lean<VersionRow | null>();
    if (!conversation) return null;
    const newest = await ConversationMessage.findOne({ conversationId: params.id })
      .sort({ updatedAt: -1 })
      .select("updatedAt")
      .lean<{ updatedAt?: Date } | null>();
    return [
      new Date(conversation.updatedAt ?? 0).getTime(),
      String(conversation.lastMessageId ?? ""),
      conversation.unreadForStore ?? 0,
      conversation.status ?? "",
      new Date(newest?.updatedAt ?? 0).getTime(),
      // Whether the conversation names its customer, and what it offers, follow the grant.
      grantCan(workspace, "VIEW_ORDER_CUSTOMERS"),
      grantCan(workspace, "REPLY_INBOX"),
      grantCan(workspace, "MANAGE_INBOX"),
    ];
  },
  handler: async ({ input, params, session, workspace, scope }) => {
    const conversationId = conversationIdParam(params.id);
    const before = decodeChatCursor(input.cursor, (value) => mongoose.isValidObjectId(value));
    await connectDB();
    const page = await listConversationMessages({
      conversationId,
      viewer: bizConversationViewer(session, workspace),
      before,
      limit: input.limit ?? LIST_DEFAULT_LIMIT,
    });
    const customers = await conversationCustomers([page.conversation], { session, workspace, scope });
    return {
      // The service pages oldest-to-newest within a page; the app reads the
      // newest first.
      items: page.messages.reverse().map(toBizMessage),
      nextCursor: encodeChatCursor(page.nextCursor),
      conversation: toBizConversation(page.conversation, {
        workspace,
        operatorId: session.user.id,
        customerId: customers.get(page.conversation._id),
      }),
    };
  },
});
