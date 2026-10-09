import { grantCan } from "@/lib/api-core/biz/access";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import { bizConversationViewer } from "@/lib/api-core/biz/inbox/biz-inbox";
import { orderTabFilter } from "@/lib/api-core/biz/orders/tabs";
import { customerDirectoryIsGlobal, type BizScope } from "@/lib/api-core/biz/scope";
import { MobileApiError } from "@/lib/api-core/errors";
import type { MobileSession } from "@/lib/api-core/ports";
import { getConversationAccessQuery } from "@/lib/conversations/service";
import {
  findBusinessCustomer,
  type BusinessCustomer,
  type CustomerReach,
  type NoteBusiness,
} from "@/lib/customers/business-customers";

const NOTHING = { _id: { $exists: false } };

/**
 * What the operator can see, for the customer service
 * (lib/customers/business-customers.ts), from the same filters as the rest of
 * the API: the order list's "all" tab (orders/tabs.ts, a seller's being the
 * orders with a consignment of theirs) and, with the inbox, the conversations
 * GET /conversations lists.
 */
export function customerReachOf(context: {
  session: MobileSession;
  workspace: BizWorkspaceGrant;
  scope: BizScope;
}): CustomerReach {
  const { session, workspace, scope } = context;
  return {
    everyone: customerDirectoryIsGlobal(scope),
    orders: orderTabFilter("all", scope) ?? NOTHING,
    conversations: grantCan(workspace, "VIEW_INBOX")
      ? getConversationAccessQuery(bizConversationViewer(session, workspace))
      : null,
    sellerId: workspace.workspace === "vendor" ? workspace.vendor.id : null,
  };
}

/** Whose notes the operator reads and writes: the store's team's, or their seller's. */
export function noteBusinessOf(workspace: BizWorkspaceGrant): NoteBusiness {
  return workspace.workspace === "vendor" ? { vendorId: workspace.vendor.id } : "platform";
}

/** The id as the app sent it, percent-encoded or not (`guest:` carries a colon). */
export function customerIdFromPath(raw: string): string {
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The customer in the path, among the operator's; 404 otherwise. */
export async function requireCustomer(
  rawId: string,
  context: { session: MobileSession; workspace: BizWorkspaceGrant; scope: BizScope },
): Promise<{ customer: BusinessCustomer; reach: CustomerReach }> {
  const reach = customerReachOf(context);
  const customer = await findBusinessCustomer(customerIdFromPath(rawId), reach);
  if (!customer) throw new MobileApiError(404, "NOT_FOUND", "Customer not found.");
  return { customer, reach };
}
