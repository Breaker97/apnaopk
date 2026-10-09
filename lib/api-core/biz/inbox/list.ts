import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/biz/v1/common";
import { ConversationList, ConversationListQuery } from "@/contracts/mobile/biz/v1/inbox";
import { BIZ_ACCESS, grantCan } from "@/lib/api-core/biz/access";
import { defineBizRoute } from "@/lib/api-core/registry";
import { decodeChatCursor, encodeChatCursor } from "@/lib/api-core/shop/chat/shopper-chat";
import {
  countUnreadConversationMessages,
  getConversationListVersion,
  listConversations,
  parseConversationCursor,
} from "@/lib/conversations/service";
import { customerListFilter } from "@/lib/customers/business-customers";
import { connectDB } from "@/lib/db";
import { bizConversationViewer, toBizConversation } from "./biz-inbox";
import { conversationCustomers } from "./customers";

const validCursor = (value: string) => Boolean(parseConversationCursor(value));

/** No conversation: a customer id that names nobody. */
const NOTHING = { _id: { $exists: false } };

/** `customerId` as a filter: one customer's threads, within the viewer's own. */
async function customerFilter(customerId: string | undefined): Promise<Record<string, unknown> | undefined> {
  if (!customerId) return undefined;
  return (await customerListFilter(customerId, "conversations")) ?? NOTHING;
}

/**
 * GET /conversations: the operator's conversations, most recent message
 * first, with the unread total for the tab's badge; one customer's with
 * `customerId`; the operator's own, or nobody's, with `assignee`.
 *
 * The same `listConversations` the website's inbox reads, for the viewer the
 * workspace makes (./biz-inbox.ts). The app asks again on a push, on coming
 * back to the foreground and while the inbox shows, and most of those find
 * nothing new: the validator reads the page's ids and newest `updatedAt`
 * (no populates) and the unread total (one aggregate on the partial index),
 * and an unchanged list answers 304 before it is built.
 */
export const inboxConversationListRoute = defineBizRoute({
  id: "inbox.conversations.list",
  method: "GET",
  path: "/conversations",
  auth: "user",
  ...BIZ_ACCESS.VIEW_INBOX,
  cache: { kind: "private" },
  input: ConversationListQuery,
  output: ConversationList,
  validator: async ({ input, session, workspace }) => {
    const viewer = bizConversationViewer(session, workspace);
    const before = decodeChatCursor(input.cursor, validCursor);
    await connectDB();
    const [page, unreadCount] = await Promise.all([
      getConversationListVersion({
        viewer,
        limit: input.limit ?? LIST_DEFAULT_LIMIT,
        status: input.status,
        unreadOnly: input.unreadOnly,
        search: input.search,
        customer: await customerFilter(input.customerId),
        assignee: input.assignee,
        before,
      }),
      countUnreadConversationMessages({ viewer }),
    ]);
    // Whether each row names its customer, and what it offers, follow the grant.
    return [
      page.conversations,
      page.newestUpdatedAt,
      unreadCount,
      grantCan(workspace, "VIEW_ORDER_CUSTOMERS"),
      grantCan(workspace, "REPLY_INBOX"),
      grantCan(workspace, "MANAGE_INBOX"),
    ];
  },
  handler: async ({ input, session, workspace, scope }) => {
    const viewer = bizConversationViewer(session, workspace);
    const before = decodeChatCursor(input.cursor, validCursor);
    await connectDB();
    const [page, unreadCount] = await Promise.all([
      listConversations({
        viewer,
        limit: input.limit ?? LIST_DEFAULT_LIMIT,
        status: input.status,
        unreadOnly: input.unreadOnly,
        search: input.search,
        customer: await customerFilter(input.customerId),
        assignee: input.assignee,
        before,
      }),
      countUnreadConversationMessages({ viewer }),
    ]);
    const customers = await conversationCustomers(page.conversations, { session, workspace, scope });
    const now = Date.now();
    return {
      items: page.conversations.map((conversation) =>
        toBizConversation(conversation, {
          workspace,
          operatorId: session.user.id,
          now,
          customerId: customers.get(conversation._id),
        }),
      ),
      nextCursor: encodeChatCursor(page.nextCursor),
      unreadCount,
    };
  },
});
