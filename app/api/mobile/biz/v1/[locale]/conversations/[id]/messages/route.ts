import { inboxMessagesRoute } from "@/lib/api-core/biz/inbox/messages";
import { inboxSendMessageRoute } from "@/lib/api-core/biz/inbox/send";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(inboxMessagesRoute);
export const POST = bizPrivateRoute(inboxSendMessageRoute);
