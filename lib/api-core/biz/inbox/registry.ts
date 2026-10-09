import type { BizRouteEntry } from "@/lib/api-core/registry";
import { inboxAssigneesRoute, inboxAssignmentRoute } from "./assignment";
import { inboxSendAttachmentRoute } from "./attachments";
import { inboxConversationListRoute } from "./list";
import { inboxMessagesRoute } from "./messages";
import { inboxNoteRoute } from "./notes";
import { inboxConversationReadRoute } from "./read";
import { inboxSendMessageRoute } from "./send";
import { inboxStatusRoute } from "./status";

/**
 * Conversations and their messages (session B5), and the team's own work on
 * them: internal notes, assignment and status (R2).
 *
 * One module per endpoint in this folder, each exporting its `defineBizRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const inboxRoutes: readonly BizRouteEntry[] = [
  inboxConversationListRoute,
  inboxMessagesRoute,
  inboxSendMessageRoute,
  inboxSendAttachmentRoute,
  inboxConversationReadRoute,
  inboxNoteRoute,
  inboxAssigneesRoute,
  inboxAssignmentRoute,
  inboxStatusRoute,
];
