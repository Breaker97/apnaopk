import { inboxConversationReadRoute } from "@/lib/api-core/biz/inbox/read";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const POST = bizPrivateRoute(inboxConversationReadRoute);
