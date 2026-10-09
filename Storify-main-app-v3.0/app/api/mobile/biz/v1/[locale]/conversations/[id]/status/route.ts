import { inboxStatusRoute } from "@/lib/api-core/biz/inbox/status";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const PUT = bizPrivateRoute(inboxStatusRoute);
