import {
  Conversation,
  ConversationStatusRequest,
  INBOX_REASONS,
} from "@/contracts/mobile/biz/v1/inbox";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { MobileApiError } from "@/lib/api-core/errors";
import { conversationIdParam } from "@/lib/api-core/shop/chat/shopper-chat";
import { defineBizRoute } from "@/lib/api-core/registry";
import {
  assertConversationAccess,
  serializeConversation,
  updateConversationStatus,
} from "@/lib/conversations/service";
import { connectDB } from "@/lib/db";
import { bizConversationViewer, conversationActions, toBizConversation } from "./biz-inbox";
import { conversationCustomers } from "./customers";

/** The step that leads to each status, and the statuses that already are it. */
const STEPS = {
  resolved: { action: "resolve", already: ["resolved"] },
  // A pending conversation (the team answered last) is open as far as reopening goes.
  open: { action: "reopen", already: ["open", "pending"] },
} as const;

/**
 * PUT /conversations/{id}/status: resolve a conversation, or open it again,
 * as the website's inbox does (`updateConversationStatus`, the manage
 * permission). Only from where the step starts (the conversation's
 * `actions`): a conversation closed or marked spam meanwhile is
 * `409 STATUS_CHANGE_NOT_ALLOWED`; closing and spam stay on the website.
 *
 * Not keyed: asking for the status it already has changes nothing, so a
 * retry is safe.
 */
export const inboxStatusRoute = defineBizRoute({
  id: "inbox.status.update",
  method: "PUT",
  path: "/conversations/{id}/status",
  auth: "user",
  ...BIZ_ACCESS.MANAGE_INBOX,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:inbox:status", preset: "moderate" },
  demo: "default",
  reasons: { values: INBOX_REASONS },
  input: ConversationStatusRequest,
  output: Conversation,
  handler: async ({ input, params, session, workspace, scope }) => {
    const conversationId = conversationIdParam(params.id);
    const viewer = bizConversationViewer(session, workspace);
    const operatorId = session.user.id;
    await connectDB();
    const current = serializeConversation(await assertConversationAccess(conversationId, viewer), viewer);
    const step = STEPS[input.status];
    let conversation = current;
    if (!(step.already as readonly string[]).includes(current.status)) {
      if (!conversationActions(current, { workspace, operatorId }).includes(step.action)) {
        throw new MobileApiError(409, "CONFLICT", "This conversation cannot take that step now.", {
          reason: "STATUS_CHANGE_NOT_ALLOWED",
          details: { status: current.status },
        });
      }
      conversation = await updateConversationStatus({ conversationId, viewer, status: input.status });
    }
    const customers = await conversationCustomers([conversation], { session, workspace, scope });
    return toBizConversation(conversation, {
      workspace,
      operatorId,
      customerId: customers.get(conversation._id),
    });
  },
});
