import { inboxConversationListRoute } from "@/lib/api-core/biz/inbox/list";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(inboxConversationListRoute);
