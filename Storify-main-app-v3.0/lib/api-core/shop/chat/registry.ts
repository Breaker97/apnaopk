import type { RouteEntry } from "@/lib/api-core/registry";
import { chatSendAttachmentRoute } from "./attachments";
import { chatDraftRoute } from "./draft";
import { chatConversationListRoute } from "./list";
import { chatMessagesRoute } from "./messages";
import { chatReadRoute } from "./read";
import { chatSendRoute } from "./send";
import { chatStartRoute } from "./start";

/**
 * The shopper's chat with the store.
 *
 * One module per endpoint in this folder, each exporting its `defineRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const chatRoutes: readonly RouteEntry[] = [
  chatDraftRoute,
  chatConversationListRoute,
  chatStartRoute,
  chatMessagesRoute,
  chatSendRoute,
  chatSendAttachmentRoute,
  chatReadRoute,
];
