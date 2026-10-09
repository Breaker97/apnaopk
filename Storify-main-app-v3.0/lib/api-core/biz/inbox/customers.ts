import { grantCan } from "@/lib/api-core/biz/access";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import { customerReachOf } from "@/lib/api-core/biz/customers/reach";
import type { BizScope } from "@/lib/api-core/biz/scope";
import type { MobileSession } from "@/lib/api-core/ports";
import { customerIdsOfConversations } from "@/lib/customers/business-customers";
import type { ConversationDTO } from "@/lib/conversations/types";

/**
 * Who each conversation is with, as a customer the operator may open (a
 * conversation's `customerId`), by conversation id. Only for an operator who
 * may see customers; nobody is asked for otherwise. A signed-in writer costs
 * nothing; guests take one read of their records (and, for an operator who
 * sees part of the store, one of their orders) for the whole page.
 */
export async function conversationCustomers(
  conversations: readonly ConversationDTO[],
  context: { session: MobileSession; workspace: BizWorkspaceGrant; scope: BizScope },
): Promise<Map<string, string>> {
  if (conversations.length === 0 || !grantCan(context.workspace, "VIEW_ORDER_CUSTOMERS")) return new Map();
  return customerIdsOfConversations(
    conversations.map((conversation) => ({
      id: conversation._id,
      customerUserId: conversation.customerUserId,
      email: conversation.contact.email,
    })),
    customerReachOf(context),
  );
}
