import {
  Conversation,
  ConversationAssignees,
  ConversationAssignmentRequest,
  INBOX_REASONS,
} from "@/contracts/mobile/biz/v1/inbox";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { MobileApiError } from "@/lib/api-core/errors";
import { absoluteUrl } from "@/lib/api-core/shop/absolute-url";
import { conversationIdParam } from "@/lib/api-core/shop/chat/shopper-chat";
import { defineBizRoute } from "@/lib/api-core/registry";
import {
  getConversationAssignmentOptions,
  updateConversationAssignment,
} from "@/lib/conversations/assignment";
import { assertConversationAccess, serializeConversation } from "@/lib/conversations/service";
import { connectDB } from "@/lib/db";
import { bizConversationViewer, conversationActions, toBizConversation } from "./biz-inbox";
import { conversationCustomers } from "./customers";

/**
 * GET /conversations/{id}/assignees: who the conversation may be given to,
 * for the `assign` action. The website's own list
 * (lib/conversations/assignment.ts): the store's administrators and its
 * inbox staff for the store's conversations; the seller, their inbox staff
 * and the store's administrators for a seller's. A seller's operators never
 * see the store's team listed. Active accounts only, by name.
 */
export const inboxAssigneesRoute = defineBizRoute({
  id: "inbox.assignees.list",
  method: "GET",
  path: "/conversations/{id}/assignees",
  auth: "user",
  ...BIZ_ACCESS.MANAGE_INBOX,
  cache: { kind: "private" },
  output: ConversationAssignees,
  handler: async ({ params, session, workspace }) => {
    const conversationId = conversationIdParam(params.id);
    await connectDB();
    const options = await getConversationAssignmentOptions({
      conversationId,
      viewer: bizConversationViewer(session, workspace),
    });
    return {
      items: options.assignees.map((assignee) => {
        const imageUrl = absoluteUrl(assignee.image);
        return {
          id: assignee.userId,
          name: assignee.name,
          ...(imageUrl ? { imageUrl } : {}),
          ...(assignee.email ? { email: assignee.email } : {}),
          role: assignee.role,
        };
      }),
    };
  },
});

/**
 * PUT /conversations/{id}/assignment: give the conversation to someone in the
 * team, to the operator themselves, or to nobody (`assigneeId: null`), as the
 * website's inbox does (`updateConversationAssignment`). Taking it oneself is
 * the `claim` action (the reply permission); anything else is `assign` (the
 * manage permission), refused otherwise. Someone who cannot take it is
 * `409 ASSIGNEE_NOT_AVAILABLE`.
 *
 * Not keyed: it sets a value, and setting the one already set changes nothing,
 * so a retry is safe.
 */
export const inboxAssignmentRoute = defineBizRoute({
  id: "inbox.assignment.update",
  method: "PUT",
  path: "/conversations/{id}/assignment",
  auth: "user",
  ...BIZ_ACCESS.REPLY_INBOX,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:inbox:assignment", preset: "moderate" },
  demo: "default",
  reasons: { values: INBOX_REASONS },
  input: ConversationAssignmentRequest,
  output: Conversation,
  handler: async ({ input, params, session, workspace, scope }) => {
    const conversationId = conversationIdParam(params.id);
    const viewer = bizConversationViewer(session, workspace);
    const operatorId = session.user.id;
    await connectDB();
    const current = serializeConversation(await assertConversationAccess(conversationId, viewer), viewer);
    const wanted = input.assigneeId;
    const unchanged = (current.assignedTo?.userId ?? null) === wanted;
    const offered = conversationActions(current, { workspace, operatorId });
    const allowed =
      wanted === operatorId
        ? offered.includes("claim") || offered.includes("assign") || unchanged
        : offered.includes("assign");
    if (!allowed) {
      throw new MobileApiError(403, "AUTHORIZATION_ERROR", "You do not have permission to do this.");
    }
    const conversation = unchanged
      ? current
      : await updateConversationAssignment({ conversationId, viewer, userId: wanted });
    const customers = await conversationCustomers([conversation], { session, workspace, scope });
    return toBizConversation(conversation, {
      workspace,
      operatorId,
      customerId: customers.get(conversation._id),
    });
  },
});
